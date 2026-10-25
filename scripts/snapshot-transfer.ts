import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as v from 'valibot';
import { SnapshotDateSchema } from '../src/schema.ts';
import { parseJson } from './json.ts';
import { loadVerifiedSnapshots, readManifest, replaceDirectory, selectIds, sha256, stageManifest } from './snapshots.ts';
import type { SnapshotStorage } from './snapshot-storage.ts';

export async function concurrently<T>(items: T[], action: (item: T) => Promise<void>, concurrency = 8) {
  let next = 0;
  let failed = false;
  let failure: unknown;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (!failed && next < items.length) {
        const item = items[next++];
        try {
          await action(item);
        } catch (error) {
          failed = true;
          failure = error;
        }
      }
    }),
  );
  if (failed) throw failure;
}

interface SnapshotOptions {
  sources?: string;
  data?: string;
  log?: (line: string) => void;
}

export async function archiveSnapshots(
  storage: SnapshotStorage,
  ids: string[],
  { sources = path.resolve('sources'), data = path.resolve('data'), log = console.log }: SnapshotOptions = {},
) {
  const manifests = await loadVerifiedSnapshots(ids, sources, data);
  const totals = { ids: manifests.size, files: 0, bytes: 0, skipped: 0 };
  async function putImmutable(key: string, bytes: Uint8Array, hash: string) {
    const existing = await storage.head(key);
    if (existing) {
      if (existing.sha256 !== hash)
        throw new Error(`${key}: 既存オブジェクトのsha256が異なります (${existing.sha256} != ${hash})`);
      return true;
    }
    const result = await storage.put(key, bytes, hash);
    if (result === 'exists') {
      const raced = await storage.head(key);
      if (raced?.sha256 !== hash) throw new Error(`${key}: 同時作成されたオブジェクトのsha256が異なります`);
      return true;
    }
    return false;
  }
  for (const [id, manifest] of manifests) {
    const prefix = `snapshots/${id}/${manifest.fetchedOn}`;
    const progress = { files: 0, bytes: 0, skipped: 0 };
    await concurrently(Object.entries(manifest.files), async ([name, expected]) => {
      const bytes = await readFile(path.join(sources, id, name));
      if (bytes.length !== expected.size || sha256(bytes) !== expected.sha256)
        throw new Error(`${id}/${name}: 検証後にローカルファイルが変わりました`);
      if (await putImmutable(`${prefix}/${name}`, bytes, expected.sha256)) progress.skipped++;
      progress.files++;
      progress.bytes += bytes.length;
    });
    const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
    if (await putImmutable(`${prefix}/snapshot.json`, bytes, sha256(bytes))) progress.skipped++;
    totals.files += progress.files;
    totals.bytes += progress.bytes;
    totals.skipped += progress.skipped;
    log(
      `${id}@${manifest.fetchedOn}: ${progress.files} files, ${progress.bytes} bytes, ${progress.skipped} skipped (manifest含む)`,
    );
  }
  log(`archive: ${totals.ids} ids, ${totals.files} files, ${totals.bytes} bytes, ${totals.skipped} skipped (manifest含む)`);
  return totals;
}

export function restoreSelections(specs: string[]) {
  const parsed = specs.map((spec) => {
    const parts = spec.split('@');
    if (parts.length > 2 || (parts.length === 2 && !parts[1])) throw new Error(`復元指定が不正です: ${spec}`);
    const [id, date] = parts;
    if (date) v.parse(SnapshotDateSchema, date);
    return { id, date };
  });
  const ids = selectIds(parsed.map(({ id }) => id));
  return ids.map((id) => ({ id, date: parsed.find((item) => item.id === id)?.date }));
}

export async function restoreSnapshots(
  storage: SnapshotStorage,
  specs: string[],
  {
    sources = path.resolve('sources'),
    data = path.resolve('data'),
    dest = sources,
    log = console.log,
  }: SnapshotOptions & { dest?: string } = {},
) {
  const selections = restoreSelections(specs);
  const totals = { ids: selections.length, files: 0, bytes: 0 };
  for (const { id, date } of selections) {
    const committed = await readManifest(id, data);
    const fetchedOn = date ?? committed.fetchedOn;
    const prefix = `snapshots/${id}/${fetchedOn}`;
    const manifest = parseJson(Buffer.from(await storage.get(`${prefix}/snapshot.json`)).toString('utf8'), 'snapshot.json');
    if (manifest.fetchedOn !== fetchedOn) throw new Error(`${prefix}: マニフェストの取得日が一致しません`);
    let staged: Awaited<ReturnType<typeof stageManifest>> | undefined;
    const updateManifest = path.resolve(dest) === path.resolve(sources) && fetchedOn !== committed.fetchedOn;
    let bytes = 0;
    try {
      await replaceDirectory(
        path.join(dest, id),
        async (temporary) => {
          await concurrently(Object.entries(manifest.files), async ([name, expected]) => {
            const file = path.resolve(temporary, name);
            if (!file.startsWith(`${path.resolve(temporary)}${path.sep}`)) throw new Error(`${name}: 復元先の外を指しています`);
            const content = await storage.get(`${prefix}/${name}`);
            if (content.length !== expected.size || sha256(content) !== expected.sha256)
              throw new Error(`${prefix}/${name}: sha256またはsizeが一致しません`);
            await mkdir(path.dirname(file), { recursive: true });
            await writeFile(file, content);
            bytes += content.length;
          });
          if (updateManifest) staged = await stageManifest(id, manifest, data);
        },
        async () => {
          await staged?.commit();
        },
      );
    } finally {
      await staged?.cleanup();
    }
    totals.files += Object.keys(manifest.files).length;
    totals.bytes += bytes;
    log(
      `${id}@${fetchedOn}: ${Object.keys(manifest.files).length} files, ${bytes} bytes${updateManifest ? `, data/${id}/snapshot.json を更新しました` : ''}`,
    );
  }
  log(`restore: ${totals.ids} ids, ${totals.files} files, ${totals.bytes} bytes -> ${dest}`);
  return totals;
}
