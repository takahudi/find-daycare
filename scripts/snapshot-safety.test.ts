import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { writeJson } from './json.ts';
import { archiveSnapshots, restoreSnapshots } from './snapshot-transfer.ts';
import type { SnapshotStorage } from './snapshot-storage.ts';
import { createManifest, fetchSnapshot } from './snapshots.ts';

let root: string;
let sources: string;
let data: string;
let objects: Map<string, { bytes: Uint8Array; sha256: string }>;
let storage: SnapshotStorage;
const getMock = vi.fn<SnapshotStorage['get']>();
const headMock = vi.fn<SnapshotStorage['head']>();
const date = '2026-10-22';
const options = () => ({ sources, data, log: () => {} });
const files = ['list.xlsx', 'vacancy.pdf', 'vacancy_page.html', 'kigyo_page.html', 'facility-pdfs/1.pdf'];
const download = vi.fn(async (dir: string) => {
  for (const file of files) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), 'new');
  }
});

beforeEach(async () => {
  await mkdir(path.resolve('.audit'), { recursive: true });
  root = await mkdtemp(path.resolve('.audit/snapshot-safety-'));
  sources = path.join(root, 'sources');
  data = path.join(root, 'data');
  await mkdir(path.join(sources, 'chuo'), { recursive: true });
  await mkdir(path.join(data, 'chuo'), { recursive: true });
  await writeFile(path.join(sources, 'chuo', 'old'), 'keep');
  await writeJson(
    'snapshot.json',
    path.join(data, 'chuo', 'snapshot.json'),
    await createManifest(path.join(sources, 'chuo'), date),
  );
  objects = new Map();
  storage = {
    head: headMock.mockReset().mockImplementation(async (key) => {
      const object = objects.get(key);
      return object ? { sha256: object.sha256 } : null;
    }),
    put: async (key, bytes, hash) => {
      objects.set(key, { bytes: bytes.slice(), sha256: hash });
      return 'created';
    },
    get: getMock.mockReset().mockImplementation(async (key) => {
      const object = objects.get(key);
      if (!object) throw new Error('missing ' + key);
      return object.bytes.slice();
    }),
  };
  await archiveSnapshots(storage, ['chuo'], options());
  download.mockClear();
  getMock.mockClear();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it.each(['fetch', 'restore'] as const)('%sは別ブランチのmanifestと異なる未保管ツリーを取得前に拒否する', async (command) => {
  await writeFile(path.join(sources, 'chuo', 'old'), 'unarchived from another branch');
  const result =
    command === 'fetch'
      ? fetchSnapshot('chuo', download, { ...options(), storage })
      : restoreSnapshots(storage, ['chuo'], options());
  await expect(result).rejects.toThrow(/chuo[\s\S]*old[\s\S]*pnpm data:archive chuo[\s\S]*--discard-unarchived chuo/);
  expect(await readFile(path.join(sources, 'chuo', 'old'), 'utf8')).toBe('unarchived from another branch');
  expect(download).not.toHaveBeenCalled();
  expect(getMock).not.toHaveBeenCalled();
});

it.each(['fetch', 'restore'] as const)('%sはmanifestなしの既存ツリーを取得前に拒否する', async (command) => {
  await rm(path.join(data, 'chuo', 'snapshot.json'));
  const result =
    command === 'fetch'
      ? fetchSnapshot('chuo', download, { ...options(), storage })
      : restoreSnapshots(storage, ['chuo@' + date], options());
  await expect(result).rejects.toThrow(/chuo[\s\S]*マニフェスト[\s\S]*--discard-unarchived chuo/);
  expect(await readFile(path.join(sources, 'chuo', 'old'), 'utf8')).toBe('keep');
  expect(download).not.toHaveBeenCalled();
  expect(getMock).not.toHaveBeenCalled();
});

for (const command of ['fetch', 'restore'] as const) {
  it.each(['credentials', 'unarchived', 'hash'])('%sなら' + command + 'は既存ツリーを取得前に拒否する', async (mode) => {
    if (mode === 'unarchived') objects.clear();
    if (mode === 'hash') {
      const key = 'snapshots/chuo/' + date + '/snapshot.json';
      const object = objects.get(key);
      if (!object) throw new Error('fixture missing');
      objects.set(key, { ...object, sha256: 'different' });
    }
    const configured = mode === 'credentials' ? undefined : storage;
    const result =
      command === 'fetch'
        ? fetchSnapshot('chuo', download, { ...options(), storage: configured })
        : restoreSnapshots(configured, ['chuo'], options());
    await expect(result).rejects.toThrow(mode === 'credentials' ? /chuo.*認証情報/ : /chuo.*保管されていません/);
    await expect(result).rejects.toThrow('--discard-unarchived chuo');
    expect(await readFile(path.join(sources, 'chuo', 'old'), 'utf8')).toBe('keep');
    expect(download).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
  });

  it.each(['verified', 'missing', 'discard', 'no manifest'])(
    '%sなら' + command + 'は置換して旧ツリーを残さない',
    async (mode) => {
      if (mode === 'missing') await rm(path.join(sources, 'chuo'), { recursive: true });
      if (mode === 'discard') await writeFile(path.join(sources, 'chuo', 'old'), 'unarchived');
      if (mode === 'no manifest') await rm(path.join(data, 'chuo', 'snapshot.json'));
      const discardUnarchived = ['discard', 'no manifest'].includes(mode) ? ['chuo'] : [];
      if (command === 'fetch') {
        await fetchSnapshot('chuo', download, { ...options(), storage, discardUnarchived });
        expect(await readFile(path.join(sources, 'chuo', 'list.xlsx'), 'utf8')).toBe('new');
      } else {
        await restoreSnapshots(storage, ['chuo@' + date], { ...options(), discardUnarchived });
        expect(await readFile(path.join(sources, 'chuo', 'old'), 'utf8')).toBe('keep');
      }
      expect(await readdir(sources)).toEqual(['chuo']);
    },
  );
}

it('fetchの削除許可は指定したidだけに適用する', async () => {
  await expect(fetchSnapshot('chuo', download, { ...options(), discardUnarchived: ['city'] })).rejects.toThrow('認証情報');
  expect(download).not.toHaveBeenCalled();
});

it('別destへのrestoreは未保管の旧ツリーを置換できる', async () => {
  const dest = path.join(root, 'dest');
  await mkdir(path.join(dest, 'chuo'), { recursive: true });
  await writeFile(path.join(dest, 'chuo', 'unarchived'), 'delete');
  await writeFile(path.join(sources, 'chuo', 'old'), 'keep source untouched');
  await restoreSnapshots(storage, ['chuo'], { ...options(), dest });
  expect(await readdir(path.join(dest, 'chuo'))).toEqual(['old']);
  expect(await readFile(path.join(sources, 'chuo', 'old'), 'utf8')).toBe('keep source untouched');
});

it.each(['missing', 'discard'])('fetchは認証情報がなくても%sなら取得できる', async (mode) => {
  if (mode === 'missing') await rm(path.join(sources, 'chuo'), { recursive: true });
  await fetchSnapshot('chuo', download, { ...options(), discardUnarchived: mode === 'discard' ? ['chuo'] : [] });
  expect(await readFile(path.join(sources, 'chuo', 'list.xlsx'), 'utf8')).toBe('new');
  expect(headMock).toHaveBeenCalledTimes(2);
});

it('restoreの削除許可は指定したidだけに適用する', async () => {
  await writeFile(path.join(sources, 'chuo', 'old'), 'unarchived');
  await expect(restoreSnapshots(storage, ['chuo'], { ...options(), discardUnarchived: ['city'] })).rejects.toThrow('chuo');
  expect(getMock).not.toHaveBeenCalled();
  expect(await readFile(path.join(sources, 'chuo', 'old'), 'utf8')).toBe('unarchived');
});

it('restoreは後続idの拒否もGET前に検出する', async () => {
  await mkdir(path.join(sources, 'city'), { recursive: true });
  await writeFile(path.join(sources, 'city', 'unarchived'), 'keep');
  await expect(restoreSnapshots(storage, ['chuo', 'city'], options())).rejects.toThrow('city');
  expect(getMock).not.toHaveBeenCalled();
  expect(await readFile(path.join(sources, 'chuo', 'old'), 'utf8')).toBe('keep');
});
