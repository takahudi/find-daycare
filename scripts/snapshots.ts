import { createHash, randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { SnapshotDateSchema } from '../src/schema.ts';
import * as v from 'valibot';
import type { Snapshot } from './data-schema.ts';
import { parseJson, validateJson, writeJson } from './json.ts';
import type { SnapshotStorage } from './snapshot-storage.ts';
import { WARDS } from './wards.ts';

export const SNAPSHOT_IDS = [...WARDS.map(({ id }) => id), 'city'];
export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const manifestBytes = (manifest: Snapshot) => Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
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

export async function hashTree(dir: string): Promise<Snapshot['files']> {
  const files: Snapshot['files'] = {};
  for (const name of await listLocalFiles(dir)) {
    const bytes = await readFile(path.join(dir, name));
    files[name] = { sha256: sha256(bytes), size: bytes.length };
  }
  return files;
}

export async function createManifest(dir: string, fetchedOn?: string): Promise<Snapshot> {
  const files = await hashTree(dir);
  const dates = new Set<string>();
  if (!fetchedOn) {
    for (const name of Object.keys(files)) dates.add(jstDate((await stat(path.join(dir, name))).mtime));
    if (dates.size !== 1) throw new Error(`${dir}: 取得日が混在しています: ${[...dates].join(', ')}`);
  }
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
  let actual: Snapshot['files'];
  try {
    actual = await hashTree(dir);
  } catch (error) {
    throw new Error(`${dir}: 一次情報を検証できません。pnpm data:restore で復元してください`, { cause: error });
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
  if (mismatches.length)
    throw new Error(`${dir}: スナップショットと不一致。pnpm data:restore で復元してください\n${mismatches.join('\n')}`);
}

export async function loadVerifiedSnapshots(ids: string[], sources = path.resolve('sources'), data = path.resolve('data')) {
  const manifests: Record<string, Snapshot> = {};
  for (const id of selectIds(ids)) {
    const manifest = await readManifest(id, data);
    await verifyLocalFiles(path.join(sources, id), manifest);
    manifests[id] = manifest;
  }
  return manifests;
}

async function optionalStat(file: string) {
  return lstat(file).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  });
}

export async function renameWithRetry(from: string, to: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const busy = error instanceof Error && 'code' in error && ['EPERM', 'EACCES', 'EBUSY'].includes(String(error.code));
      if (!busy || attempt >= 20) throw error;
      await delay(Math.min(100 * 2 ** attempt, 500));
    }
  }
}

interface DirectoryCommit {
  commit(): Promise<void>;
  cleanup(): Promise<void>;
}

export async function replaceDirectory(
  target: string,
  populate: (temporary: string) => Promise<DirectoryCommit | void>,
  { preservePrevious, log = console.warn }: { preservePrevious?: string; log?: (line: string) => void } = {},
) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = await mkdtemp(path.join(path.dirname(target), `.${path.basename(target)}-new-`));
  const previous = `${temporary}-old`;
  let staged: DirectoryCommit | void = undefined;
  let movedOld = false;
  let movedNew = false;
  try {
    staged = await populate(temporary);
    const old = await optionalStat(target);
    if (old && (!old.isDirectory() || old.isSymbolicLink())) throw new Error(`${target}: 通常のディレクトリではありません`);
    if (old) {
      await renameWithRetry(target, previous);
      movedOld = true;
    }
    try {
      await renameWithRetry(temporary, target);
      movedNew = true;
      await staged?.commit();
    } catch (error) {
      if (movedNew) {
        await renameWithRetry(target, temporary);
        movedNew = false;
      }
      if (movedOld) {
        try {
          await renameWithRetry(previous, target);
        } catch {
          await cp(previous, target, { recursive: true, errorOnExist: true, force: false });
        }
        movedOld = false;
      }
      throw error;
    }
  } catch (error) {
    const kept = movedNew ? target : temporary;
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n一時ディレクトリを保持しました: ${kept}${movedOld ? `\n旧データを保持しました: ${previous}` : ''}`,
      { cause: error },
    );
  } finally {
    try {
      await staged?.cleanup();
    } catch (error) {
      log(`一時マニフェストの削除に失敗しました: ${String(error)}`);
    }
  }
  if (movedOld) {
    if (preservePrevious) {
      try {
        await mkdir(path.dirname(preservePrevious), { recursive: true });
        const kept = (await optionalStat(preservePrevious)) ? `${preservePrevious}-${randomUUID()}` : preservePrevious;
        await renameWithRetry(previous, kept);
        log(`未保管の旧データを保持しました: ${kept}。保管するか、不要なら削除してください`);
      } catch (error) {
        log(
          `未保管の旧データを保持しました: ${previous}。保管するか、不要なら削除してください。退避先への移動失敗: ${String(error)}`,
        );
      }
    } else {
      await rm(previous, { recursive: true, force: true });
    }
  }
}

export async function stageManifest(id: string, manifest: Snapshot, dataDir: string): Promise<DirectoryCommit> {
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
    commit: () => renameWithRetry(temporary, path.join(dir, 'snapshot.json')),
    cleanup: () => rm(temporary, { force: true }),
  };
}

export async function validateDownload(id: string, dir: string) {
  const files = await listLocalFiles(dir);
  const required =
    id === 'city' ? ['sukusukudata.csv', 'ninkagai_detail.pdf'] : ['list.xlsx', 'vacancy_page.html', 'kigyo_page.html'];
  const patterns: RegExp[] = [];
  if (id !== 'city') {
    const ward = WARDS.find((config) => config.id === id);
    if (!ward) throw new Error(`不明な区id: ${id}`);
    patterns.push(/^facility-pdfs\/[^/]+\.pdf$/i);
    if (ward.vacancyFile) patterns.push(/^vacancy\.(?:pdf|xlsx?)$/i);
    if (ward.kigyoFile) patterns.push(/^kigyo\.(?:pdf|xlsx)$/i);
    if (ward.kigyoInfoFile) required.push('kigyo_info.pdf');
    if (ward.kigyoInfoPage) required.push('kigyo_info_page.html');
  }
  const missing = required.filter((file) => !files.includes(file));
  for (const pattern of patterns) if (!files.some((file) => pattern.test(file))) missing.push(pattern.source);
  if (missing.length) throw new Error(`${id}: ビルドに必要な取得ファイルがありません: ${missing.join(', ')}`);
}

export async function fetchSnapshot(
  id: string,
  download: (dir: string) => Promise<void>,
  {
    sources = path.resolve('sources'),
    data = path.resolve('data'),
    fetchedOn = jstDate(),
    storage,
    forceCity = false,
    log = console.warn,
  }: {
    sources?: string;
    data?: string;
    fetchedOn?: string;
    storage?: SnapshotStorage;
    forceCity?: boolean;
    log?: (line: string) => void;
  } = {},
) {
  selectIds([id]);
  v.parse(SnapshotDateSchema, fetchedOn);
  const local = (await optionalStat(path.join(data, id, 'snapshot.json'))) ? await readManifest(id, data) : undefined;
  if (id === 'city' && local?.fetchedOn === fetchedOn && !forceCity) {
    log(`city@${fetchedOn}: 本日取得済みのため省略しました。再取得には --force-city を指定してください`);
    return;
  }
  const archived =
    local && storage
      ? (await storage.head(`snapshots/${id}/${local.fetchedOn}/snapshot.json`))?.sha256 === sha256(manifestBytes(local))
      : false;
  await replaceDirectory(
    path.join(sources, id),
    async (temporary) => {
      await download(temporary);
      await validateDownload(id, temporary);
      return stageManifest(id, await createManifest(temporary, fetchedOn), data);
    },
    {
      preservePrevious: local && !archived ? path.join(sources, '.unarchived', `${id}@${local.fetchedOn}`) : undefined,
      log,
    },
  );
}
