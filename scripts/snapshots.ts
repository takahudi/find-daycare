import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { SnapshotDateSchema } from '../src/schema.ts';
import * as v from 'valibot';
import type { Snapshot } from './data-schema.ts';
import { parseJson, validateJson, writeJson } from './json.ts';
import { WARDS } from './wards.ts';

export const SNAPSHOT_IDS = [...WARDS.map(({ id }) => id), 'city'];
export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const jstDate = (date = new Date()) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

export function selectIds(ids: string[]) {
  const selected = ids.length ? ids : SNAPSHOT_IDS;
  for (const id of selected) if (!SNAPSHOT_IDS.includes(id)) throw new Error(`不明な区id: ${id}`);
  if (new Set(selected).size !== selected.length) throw new Error('区idが重複しています');
  return selected;
}

export async function listLocalFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(relative: string) {
    for (const entry of await readdir(path.join(dir, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`${name}: 一次情報内のシンボリックリンクは許可されません`);
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) files.push(name);
      else throw new Error(`${name}: 通常ファイルではありません`);
    }
  }
  await visit('');
  return files.sort();
}

export async function createManifest(dir: string, fetchedOn?: string): Promise<Snapshot> {
  const files: Snapshot['files'] = {};
  const dates = new Set<string>();
  for (const name of await listLocalFiles(dir)) {
    const file = path.join(dir, name);
    const bytes = await readFile(file);
    files[name] = { sha256: sha256(bytes), size: bytes.length };
    if (!fetchedOn) dates.add(jstDate((await stat(file)).mtime));
  }
  if (!fetchedOn && dates.size !== 1) throw new Error(`${dir}: 取得日が混在しています: ${[...dates].join(', ')}`);
  return validateJson('snapshot.json', { fetchedOn: fetchedOn ?? [...dates][0], files });
}

export async function readManifest(id: string, dataDir = path.resolve('data')) {
  const file = path.join(dataDir, id, 'snapshot.json');
  try {
    return parseJson(await readFile(file, 'utf8'), 'snapshot.json');
  } catch (error) {
    throw new Error(`${file}: マニフェストを読み込めません。READMEのdata:restore・data:manifestを確認してください`, {
      cause: error,
    });
  }
}

export async function verifyLocalFiles(dir: string, manifest: Snapshot) {
  const actual: Snapshot['files'] = {};
  for (const name of await listLocalFiles(dir)) {
    const bytes = await readFile(path.join(dir, name));
    actual[name] = { sha256: sha256(bytes), size: bytes.length };
  }
  const mismatches: string[] = [];
  for (const [name, expected] of Object.entries(manifest.files)) {
    const file = actual[name];
    if (!file) mismatches.push(`${name}: ファイルがありません`);
    else {
      if (file.size !== expected.size) mismatches.push(`${name}: size ${file.size} != ${expected.size}`);
      if (file.sha256 !== expected.sha256) mismatches.push(`${name}: sha256 ${file.sha256} != ${expected.sha256}`);
    }
  }
  for (const name of Object.keys(actual))
    if (!Object.hasOwn(manifest.files, name)) mismatches.push(`${name}: 未登録のファイルです`);
  if (mismatches.length) throw new Error(`${dir}: スナップショットと不一致\n${mismatches.join('\n')}`);
}

export async function loadVerifiedSnapshots(ids: string[], sources = path.resolve('sources'), data = path.resolve('data')) {
  const manifests = new Map<string, Snapshot>();
  for (const id of selectIds(ids)) {
    const manifest = await readManifest(id, data);
    await verifyLocalFiles(path.join(sources, id), manifest);
    manifests.set(id, manifest);
  }
  return manifests;
}

export async function replaceDirectory(
  target: string,
  populate: (temporary: string) => Promise<void>,
  commit: () => Promise<void> = async () => {},
) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = await mkdtemp(path.join(path.dirname(target), `.${path.basename(target)}-new-`));
  const previous = `${temporary}-old`;
  let movedOld = false;
  let movedNew = false;
  try {
    await populate(temporary);
    const old = await lstat(target).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (old && (!old.isDirectory() || old.isSymbolicLink())) throw new Error(`${target}: 通常のディレクトリではありません`);
    if (old) {
      await rename(target, previous);
      movedOld = true;
    }
    try {
      await rename(temporary, target);
      movedNew = true;
      await commit();
    } catch (error) {
      if (movedNew) await rm(target, { recursive: true, force: true });
      if (movedOld) await rename(previous, target);
      throw error;
    }
    if (movedOld) await rm(previous, { recursive: true, force: true });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function stageManifest(id: string, manifest: Snapshot, dataDir: string) {
  const dir = path.join(dataDir, id);
  await mkdir(dir, { recursive: true });
  const temporary = path.join(dir, `.snapshot-${randomUUID()}.json`);
  try {
    await writeJson('snapshot.json', temporary, manifest);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return {
    commit: () => rename(temporary, path.join(dir, 'snapshot.json')),
    cleanup: () => rm(temporary, { force: true }),
  };
}

export async function fetchSnapshot(
  id: string,
  download: (dir: string) => Promise<void>,
  { sources = path.resolve('sources'), data = path.resolve('data'), fetchedOn = jstDate() } = {},
) {
  selectIds([id]);
  v.parse(SnapshotDateSchema, fetchedOn);
  let staged: Awaited<ReturnType<typeof stageManifest>> | undefined;
  try {
    await replaceDirectory(
      path.join(sources, id),
      async (temporary) => {
        await download(temporary);
        staged = await stageManifest(id, await createManifest(temporary, fetchedOn), data);
      },
      async () => {
        if (!staged) throw new Error('マニフェストが用意されていません');
        await staged.commit();
      },
    );
  } finally {
    await staged?.cleanup();
  }
}
