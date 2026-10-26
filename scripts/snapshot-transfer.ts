import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { realpath } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual, promisify } from 'node:util';
import * as v from 'valibot';
import { SnapshotDateSchema } from '../src/schema.ts';
import { parseJson } from './json.ts';
import {
  assertReplaceable,
  existingDirectory,
  loadVerifiedSnapshots,
  manifestBytes,
  readManifestIfExists,
  replaceDirectory,
  selectIds,
  sha256,
  stageManifest,
  validateDiscardIds,
} from './snapshots.ts';
import type { SnapshotStorage } from './snapshot-storage.ts';
import type { Snapshot } from './data-schema.ts';

const nativeRealpath = promisify(realpath.native);

async function realDirectoryPath(directory: string): Promise<string> {
  const resolved = path.resolve(directory);
  try {
    return await nativeRealpath(resolved);
  } catch (error) {
    const parent = path.dirname(resolved);
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT') || parent === resolved) throw error;
    return path.join(await realDirectoryPath(parent), path.basename(resolved));
  }
}

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
  const totals = { ids: Object.keys(manifests).length, files: 0, bytes: 0, skipped: 0 };
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
  for (const [id, manifest] of Object.entries(manifests)) {
    const prefix = `snapshots/${id}/${manifest.fetchedOn}`;
    const manifestContent = manifestBytes(manifest);
    const hash = sha256(manifestContent);
    const key = `${prefix}/snapshot.json`;
    const archived = await storage.head(key);
    if (archived) {
      if (archived.sha256 !== hash) throw new Error(`${key}: 既存マニフェストのsha256が異なります`);
      const files = Object.values(manifest.files);
      totals.files += files.length;
      totals.bytes += files.reduce((sum, file) => sum + file.size, 0);
      totals.skipped += files.length + 1;
      log(`${id}@${manifest.fetchedOn}: archived, skipped whole id via manifest HEAD`);
      continue;
    }
    const progress = { files: 0, bytes: 0, skipped: 0 };
    await concurrently(Object.entries(manifest.files), async ([name, expected]) => {
      const bytes = await readFile(path.join(sources, id, name));
      if (await putImmutable(`${prefix}/${name}`, bytes, expected.sha256)) progress.skipped++;
      progress.files++;
      progress.bytes += bytes.length;
    });
    if ((await storage.put(key, manifestContent, hash)) === 'exists') {
      if ((await storage.head(key))?.sha256 !== hash) throw new Error(`${key}: 同時作成されたマニフェストのsha256が異なります`);
      progress.skipped++;
    }
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
  storage: SnapshotStorage | undefined,
  specs: string[],
  {
    sources = path.resolve('sources'),
    data = path.resolve('data'),
    dest = sources,
    discardUnarchived = [],
    log = console.log,
  }: SnapshotOptions & { dest?: string; discardUnarchived?: string[] } = {},
) {
  const selections = restoreSelections(specs);
  validateDiscardIds(
    selections.map(({ id }) => id),
    discardUnarchived,
  );
  if (!storage)
    throw new Error('R2の認証情報がありません。保管と保管状況の確認の両方に認証情報が必要です。.envを設定してください');
  const canonical = (directory: string) => (process.platform === 'win32' ? directory.toLowerCase() : directory);
  const intoSources = canonical(await realDirectoryPath(dest)) === canonical(await realDirectoryPath(sources));
  const plans = [];
  for (const { id, date } of selections) {
    const local = await readManifestIfExists(id, data);
    const fetchedOn = date ?? local?.fetchedOn;
    if (!fetchedOn) throw new Error(id + ': 作業ツリーのマニフェストがありません。復元する取得日を指定してください');
    let verified: Snapshot | undefined;
    if (intoSources)
      verified = await assertReplaceable(id, path.join(sources, id), storage, data, discardUnarchived.includes(id));
    else await existingDirectory(path.join(dest, id));
    plans.push({ id, local, fetchedOn, verified });
  }
  const totals = { ids: selections.length, files: 0, bytes: 0 };
  for (const { id, local, fetchedOn, verified } of plans) {
    const prefix = `snapshots/${id}/${fetchedOn}`;
    const manifest = parseJson(Buffer.from(await storage.get(`${prefix}/snapshot.json`)).toString('utf8'), 'snapshot.json');
    if (manifest.fetchedOn !== fetchedOn) throw new Error(`${prefix}: マニフェストの取得日が一致しません`);
    if (fetchedOn === local?.fetchedOn && !isDeepStrictEqual(manifest.files, local.files))
      throw new Error(`${prefix}: R2マニフェストが作業ツリーのマニフェストと一致しません`);
    const updateManifest = intoSources && fetchedOn !== local?.fetchedOn;
    let bytes = 0;
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
        return updateManifest ? stageManifest(id, manifest, data) : undefined;
      },
      verified,
    );
    totals.files += Object.keys(manifest.files).length;
    totals.bytes += bytes;
    log(
      `${id}@${fetchedOn}: ${Object.keys(manifest.files).length} files, ${bytes} bytes${updateManifest ? `, data/${id}/snapshot.json を更新しました` : ''}`,
    );
  }
  log(`restore: ${totals.ids} ids, ${totals.files} files, ${totals.bytes} bytes -> ${dest}`);
  return totals;
}
