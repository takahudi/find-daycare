import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
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
    await expect(result).rejects.toThrow(mode === 'credentials' ? /認証情報[\s\S]*\.env/ : /chuo.*保管されていません/);
    if (mode !== 'credentials' || command === 'fetch') await expect(result).rejects.toThrow('--discard-unarchived chuo');
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
  await expect(fetchSnapshot('chuo', download, { ...options(), discardUnarchived: ['city'] })).rejects.toThrow(/city.*選択/);
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
  headMock.mockClear();
  await fetchSnapshot('chuo', download, { ...options(), discardUnarchived: mode === 'discard' ? ['chuo'] : [] });
  expect(await readFile(path.join(sources, 'chuo', 'list.xlsx'), 'utf8')).toBe('new');
  expect(headMock).not.toHaveBeenCalled();
});

it('restoreの削除許可は指定したidだけに適用する', async () => {
  await writeFile(path.join(sources, 'chuo', 'old'), 'unarchived');
  await expect(restoreSnapshots(storage, ['chuo'], { ...options(), discardUnarchived: ['city'] })).rejects.toThrow(/city.*選択/);
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

it.skipIf(process.platform !== 'win32')('sourcesの大文字小文字違いのdestも取得前に拒否する', async () => {
  await writeFile(path.join(sources, 'chuo', 'old'), 'unarchived');
  await expect(restoreSnapshots(storage, ['chuo'], { ...options(), dest: path.join(root, 'Sources') })).rejects.toThrow(
    '置換を拒否',
  );
  expect(getMock).not.toHaveBeenCalled();
  expect(await readFile(path.join(sources, 'chuo', 'old'), 'utf8')).toBe('unarchived');
});

for (const mode of ['dest junction', 'sources junction'] as const) {
  it(mode + 'の実パスもsourcesとして保護しmanifestを更新する', async (context) => {
    const original = sources;
    const alias = path.join(root, 'alias');
    try {
      await symlink(sources, alias, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (error instanceof Error && 'code' in error && ['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP'].includes(String(error.code))) {
        context.skip('OSがディレクトリリンクの作成を許可しません');
        return;
      }
      throw error;
    }
    const dest = mode === 'dest junction' ? alias : await realpath(original);
    if (mode === 'sources junction') sources = alias;
    await writeFile(path.join(original, 'chuo', 'old'), 'unarchived');
    await expect(restoreSnapshots(storage, ['chuo'], { ...options(), dest })).rejects.toThrow('置換を拒否');
    expect(getMock).not.toHaveBeenCalled();
    expect(await readFile(path.join(original, 'chuo', 'old'), 'utf8')).toBe('unarchived');
    await writeFile(path.join(original, 'chuo', 'old'), 'keep');
    const snapshotPath = path.join(data, 'chuo', 'snapshot.json');
    const newer = await createManifest(path.join(original, 'chuo'), '2026-10-23');
    await writeJson('snapshot.json', snapshotPath, newer);
    await archiveSnapshots(storage, ['chuo'], options());
    await writeJson('snapshot.json', snapshotPath, await createManifest(path.join(original, 'chuo'), date));
    await restoreSnapshots(storage, ['chuo@2026-10-23'], { ...options(), dest });
    expect(JSON.parse(await readFile(snapshotPath, 'utf8'))).toEqual(newer);
  });
}

for (const command of ['fetch', 'restore'] as const) {
  it(command + 'は検証後に変わった旧ツリーを退避先に保持し、その場所と新ツリーを案内する', async () => {
    const old = path.join(sources, 'chuo', 'old');
    const change = async () => writeFile(old, 'changed during download');
    const result =
      command === 'fetch'
        ? fetchSnapshot(
            'chuo',
            async (dir) => {
              await change();
              await download(dir);
            },
            { ...options(), storage },
          )
        : restoreSnapshots(
            {
              ...storage,
              get: async (key) => {
                await change();
                return storage.get(key);
              },
            },
            ['chuo'],
            options(),
          );
    await expect(result).rejects.toThrow('旧データを保持');
    const kept = (await readdir(sources)).find((name) => name.endsWith('-old'));
    if (!kept) throw new Error('旧ツリーの退避先がありません');
    const previous = path.join(sources, kept);
    await expect(result).rejects.toThrow(previous);
    await expect(result).rejects.toThrow(`新データ: ${path.join(sources, 'chuo')}`);
    expect(await readFile(path.join(previous, 'old'), 'utf8')).toBe('changed during download');
    expect(await readFile(path.join(sources, 'chuo', command === 'fetch' ? 'list.xlsx' : 'old'), 'utf8')).toBe(
      command === 'fetch' ? 'new' : 'keep',
    );
  });

  it.each([false, true])(command + 'はディレクトリ以外を取得前に拒否する（discard=%s）', async (discard) => {
    await rm(path.join(sources, 'chuo'), { recursive: true });
    await writeFile(path.join(sources, 'chuo'), 'keep file');
    const discardUnarchived = discard ? ['chuo'] : [];
    const result =
      command === 'fetch'
        ? fetchSnapshot('chuo', download, { ...options(), storage, discardUnarchived })
        : restoreSnapshots(storage, ['chuo'], { ...options(), discardUnarchived });
    await expect(result).rejects.toThrow('通常のディレクトリ');
    expect(download).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
    expect(await readFile(path.join(sources, 'chuo'), 'utf8')).toBe('keep file');
  });

  for (const discard of [false, true]) {
    it(command + `はリンクの旧ツリーを取得前に拒否する（discard=${discard}）`, async (context) => {
      await rm(path.join(sources, 'chuo'), { recursive: true });
      const kept = path.join(root, 'kept');
      await mkdir(kept);
      await writeFile(path.join(kept, 'old'), 'keep linked data');
      try {
        await symlink(kept, path.join(sources, 'chuo'), process.platform === 'win32' ? 'junction' : 'dir');
      } catch (error) {
        if (error instanceof Error && 'code' in error && ['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP'].includes(String(error.code))) {
          context.skip('OSがディレクトリリンクの作成を許可しません');
          return;
        }
        throw error;
      }
      const discardUnarchived = discard ? ['chuo'] : [];
      const result =
        command === 'fetch'
          ? fetchSnapshot('chuo', download, { ...options(), storage, discardUnarchived })
          : restoreSnapshots(storage, ['chuo'], { ...options(), discardUnarchived });
      await expect(result).rejects.toThrow('通常のディレクトリ');
      expect(download).not.toHaveBeenCalled();
      expect(getMock).not.toHaveBeenCalled();
      expect(await readFile(path.join(kept, 'old'), 'utf8')).toBe('keep linked data');
    });
  }

  it(command + 'はHEAD障害で再試行を案内し、削除許可を勧めない', async () => {
    headMock.mockRejectedValue(new Error('temporary HEAD failure'));
    const result =
      command === 'fetch'
        ? fetchSnapshot('chuo', download, { ...options(), storage })
        : restoreSnapshots(storage, ['chuo'], options());
    await expect(result).rejects.toThrow('再試行');
    await result.catch((error: unknown) => {
      expect(error).toBeInstanceOf(Error);
      if (error instanceof Error) expect(error.message).not.toContain('--discard-unarchived');
    });
    expect(download).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
  });
}

it('restoreはmanifestより先に認証情報を確認する', async () => {
  await rm(path.join(data, 'chuo', 'snapshot.json'));
  headMock.mockClear();
  await expect(restoreSnapshots(undefined, ['chuo'], options())).rejects.toThrow(/認証情報[\s\S]*\.env/);
  expect(headMock).not.toHaveBeenCalled();
  expect(getMock).not.toHaveBeenCalled();
});
