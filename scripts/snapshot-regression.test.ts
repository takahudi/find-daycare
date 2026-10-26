import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { writeJson } from './json.ts';
import { archiveSnapshots, restoreSnapshots } from './snapshot-transfer.ts';
import { createR2Storage, withRetry } from './snapshot-storage.ts';
import type { SnapshotStorage } from './snapshot-storage.ts';
import { createManifest, fetchSnapshot, sha256 } from './snapshots.ts';

let root: string;
let sources: string;
let data: string;
let manifest: Awaited<ReturnType<typeof createManifest>>;
let objects: Map<string, { bytes: Uint8Array; sha256: string }>;
let storage: SnapshotStorage;
const date = '2026-10-22';
const prefix = `snapshots/chuo/${date}`;

beforeEach(async () => {
  await mkdir(path.resolve('.audit'), { recursive: true });
  root = await mkdtemp(path.resolve('.audit/snapshot-regression-'));
  sources = path.join(root, 'sources');
  data = path.join(root, 'data');
  await mkdir(path.join(sources, 'chuo'), { recursive: true });
  await mkdir(path.join(data, 'chuo'), { recursive: true });
  await writeFile(path.join(sources, 'chuo', 'old'), 'keep');
  manifest = await createManifest(path.join(sources, 'chuo'), date);
  await writeJson('snapshot.json', path.join(data, 'chuo', 'snapshot.json'), manifest);
  objects = new Map();
  storage = {
    head: vi.fn(async (key) => {
      const object = objects.get(key);
      return object ? { sha256: object.sha256 } : null;
    }),
    put: vi.fn(async (key, bytes, hash) => {
      if (objects.has(key)) return 'exists';
      objects.set(key, { bytes: bytes.slice(), sha256: hash });
      return 'created';
    }),
    get: vi.fn(async (key) => {
      const object = objects.get(key);
      if (!object) throw new Error(`missing ${key}`);
      return object.bytes.slice();
    }),
  };
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

const options = () => ({ sources, data, log: () => {} });

it('保管済みmanifestだけをHEADして単位全体を省略する', async () => {
  await archiveSnapshots(storage, ['chuo'], options());
  const head = vi.spyOn(storage, 'head').mockClear();
  const put = vi.spyOn(storage, 'put').mockClear();
  await archiveSnapshots(storage, ['chuo'], options());
  expect(head).toHaveBeenCalledExactlyOnceWith(`${prefix}/snapshot.json`);
  expect(put).not.toHaveBeenCalled();
});

it('manifestが競合するとファイルの保管前に失敗する', async () => {
  const head = vi.spyOn(storage, 'head');
  const put = vi.spyOn(storage, 'put');
  objects.set(`${prefix}/snapshot.json`, { bytes: Buffer.from('other'), sha256: 'other' });
  await expect(archiveSnapshots(storage, ['chuo'], options())).rejects.toThrow('sha256');
  expect(head).toHaveBeenCalledExactlyOnceWith(`${prefix}/snapshot.json`);
  expect(put).not.toHaveBeenCalled();
});

it.each(['chuo', `chuo@${date}`])('同日付の異なるR2 manifestを置換前に拒否する（%s）', async (selection) => {
  const get = vi.spyOn(storage, 'get');
  const different = { ...manifest, files: { other: { sha256: sha256(Buffer.from('other')), size: 5 } } };
  objects.set(`${prefix}/snapshot.json`, { bytes: Buffer.from(JSON.stringify(different)), sha256: '' });
  objects.set(`${prefix}/other`, { bytes: Buffer.from('other'), sha256: '' });
  await expect(restoreSnapshots(storage, [selection], { ...options(), dest: path.join(root, 'dest') })).rejects.toThrow(
    '作業ツリーの',
  );
  expect(await readdir(path.join(sources, 'chuo'))).toEqual(['old']);
  expect(await readFile(path.join(data, 'chuo', 'snapshot.json'), 'utf8')).toBe(JSON.stringify(manifest, null, 2) + '\n');
  expect(get).toHaveBeenCalledTimes(1);
});

it('リンクなし取得は旧一式とmanifestを保ち、取得先を知らせる', async () => {
  let downloaded = '';
  const before = await readFile(path.join(data, 'chuo', 'snapshot.json'));
  await expect(
    fetchSnapshot(
      'chuo',
      async (dir) => {
        downloaded = dir;
        await writeFile(path.join(dir, 'vacancy_page.html'), '<html></html>');
      },
      { ...options(), discardUnarchived: ['chuo'] },
    ),
  ).rejects.toThrow('取得内容を保持しました');
  expect(await readFile(path.join(sources, 'chuo', 'old'), 'utf8')).toBe('keep');
  expect(await readFile(path.join(data, 'chuo', 'snapshot.json'))).toEqual(before);
  expect(await readFile(path.join(downloaded, 'vacancy_page.html'), 'utf8')).toBe('<html></html>');
});

it('プログラムのTypeErrorは再試行しない', async () => {
  const operation = vi.fn().mockRejectedValue(new TypeError('invalid input'));
  await expect(withRetry(operation, async () => {})).rejects.toThrow('invalid input');
  expect(operation).toHaveBeenCalledTimes(1);
});

it('PUTは実ボディのハッシュを署名し、RFC3986のパスを送る', async () => {
  vi.stubEnv('R2_ACCOUNT_ID', 'a'.repeat(32));
  vi.stubEnv('R2_ACCESS_KEY_ID', 'test-key');
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'test-secret');
  vi.stubEnv('R2_BUCKET', 'test-bucket');
  const requests: Request[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    requests.push(request);
    return new Response(null, { status: 200 });
  });
  const bytes = Buffer.from('abc');
  await createR2Storage().put(
    "snapshots/taisho/2026-10-22/homepage-sources/1/P22-R8-F(Tubame) 日本語!'*.pdf",
    bytes,
    sha256(bytes),
  );
  expect(requests).toHaveLength(1);
  expect(requests[0].headers.get('x-amz-content-sha256')).toBe(sha256(bytes));
  expect(requests[0].headers.get('authorization')).toContain('x-amz-content-sha256');
  expect(new URL(requests[0].url).pathname).toBe(
    '/test-bucket/snapshots/taisho/2026-10-22/homepage-sources/1/P22-R8-F%28Tubame%29%20%E6%97%A5%E6%9C%AC%E8%AA%9E%21%27%2A.pdf',
  );
});
