import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as v from 'valibot';
import { SnapshotSchema } from './data-schema.ts';
import { parseJson, writeJson } from './json.ts';
import { archiveSnapshots, restoreSnapshots } from './snapshot-transfer.ts';
import { createR2Storage, StorageError, withRetry } from './snapshot-storage.ts';
import type { SnapshotStorage } from './snapshot-storage.ts';
import { createManifest, fetchSnapshot, jstDate, loadVerifiedSnapshots, replaceDirectory, sha256 } from './snapshots.ts';

class MemoryStorage implements SnapshotStorage {
  objects = new Map<string, { bytes: Uint8Array; sha256: string }>();
  puts = 0;
  failKey: string | undefined;
  async head(key: string) {
    const object = this.objects.get(key);
    return object ? { sha256: object.sha256 } : null;
  }
  async put(key: string, bytes: Uint8Array, hash: string): Promise<'created' | 'exists'> {
    this.puts++;
    if (this.failKey === key) {
      this.failKey = undefined;
      throw new Error('途中失敗');
    }
    if (this.objects.has(key)) return 'exists';
    this.objects.set(key, { bytes: bytes.slice(), sha256: hash });
    return 'created';
  }
  async get(key: string) {
    const object = this.objects.get(key);
    if (!object) throw new Error(`missing: ${key}`);
    return object.bytes.slice();
  }
}

let root: string;
let sources: string;
let data: string;
let dest: string;
let store: MemoryStorage;
const date = '2026-10-22';
const prefix = `snapshots/chuo/${date}`;
const quiet = () => {};
const opts = () => ({ sources, data, log: quiet });

beforeEach(async () => {
  await mkdir(path.resolve('.audit'), { recursive: true });
  root = await mkdtemp(path.resolve('.audit/snapshot-test-'));
  sources = path.join(root, 'sources');
  data = path.join(root, 'data');
  dest = path.join(root, 'restored');
  await mkdir(path.join(sources, 'chuo', 'nested'), { recursive: true });
  await mkdir(path.join(data, 'chuo'), { recursive: true });
  await writeFile(path.join(sources, 'chuo', 'a.txt'), '一次情報\n');
  await writeFile(path.join(sources, 'chuo', 'nested', 'b.bin'), Buffer.from([0, 1, 127, 255]));
  await writeJson(
    'snapshot.json',
    path.join(data, 'chuo', 'snapshot.json'),
    await createManifest(path.join(sources, 'chuo'), date),
  );
  store = new MemoryStorage();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe('スナップショットの保管', () => {
  it('全ファイルとマニフェストを保管し、再実行時は同一ハッシュを省略する', async () => {
    expect(await archiveSnapshots(store, ['chuo'], opts())).toEqual({ ids: 1, files: 2, bytes: 17, skipped: 0 });
    expect(store.objects.size).toBe(3);
    expect(store.objects.get(`${prefix}/a.txt`)?.sha256).toBe(sha256(Buffer.from('一次情報\n')));
    expect(await archiveSnapshots(store, ['chuo'], opts())).toMatchObject({ files: 2, skipped: 3 });
    expect(store.puts).toBe(3);
  });
  it('途中失敗後の再実行で不足分の保管が完了する', async () => {
    store.failKey = `${prefix}/nested/b.bin`;
    await expect(archiveSnapshots(store, ['chuo'], opts())).rejects.toThrow('途中失敗');
    expect(store.objects.has(`${prefix}/snapshot.json`)).toBe(false);
    expect((await archiveSnapshots(store, ['chuo'], opts())).skipped).toBe(1);
    expect(store.objects.size).toBe(3);
  });
  it('既存の異なるハッシュを上書きしない', async () => {
    store.objects.set(`${prefix}/a.txt`, { bytes: Buffer.from('old'), sha256: sha256(Buffer.from('old')) });
    await expect(archiveSnapshots(store, ['chuo'], opts())).rejects.toThrow('既存オブジェクトのsha256が異なります');
    expect(Buffer.from(await store.get(`${prefix}/a.txt`)).toString()).toBe('old');
  });
  it('ローカルの欠落・余剰・ハッシュ・サイズ不一致を列挙し、アップロード前に拒否する', async () => {
    await rm(path.join(sources, 'chuo', 'nested', 'b.bin'));
    await writeFile(path.join(sources, 'chuo', 'a.txt'), 'changed');
    await writeFile(path.join(sources, 'chuo', 'extra.txt'), 'extra');
    await expect(archiveSnapshots(store, ['chuo'], opts())).rejects.toThrow(
      /a.txt: size[\s\S]*a.txt: sha256[\s\S]*nested\/b.bin: ファイルがありません[\s\S]*extra.txt: 未登録/,
    );
    expect(store.puts).toBe(0);
  });
  it('後続の区が不一致でも、先行の区をアップロードしない', async () => {
    await expect(archiveSnapshots(store, ['chuo', 'city'], opts())).rejects.toThrow('マニフェストを読み込めません');
    expect(store.puts).toBe(0);
  });
  it.each([true, false])('条件付きPUTの競合後にハッシュを確認する（一致=%s）', async (same) => {
    const put = store.put.bind(store);
    vi.spyOn(store, 'put').mockImplementation(async (key, bytes, hash) => {
      await put(key, bytes, same ? hash : 'different');
      return 'exists';
    });
    if (same) expect((await archiveSnapshots(store, ['chuo'], opts())).skipped).toBe(3);
    else await expect(archiveSnapshots(store, ['chuo'], opts())).rejects.toThrow('同時作成されたオブジェクト');
  });
});

describe('スナップショットの復元', () => {
  it('バイト単位で同一に復元し、古いファイルを残さず、別destでは作業ツリーのマニフェストを変更しない', async () => {
    await archiveSnapshots(store, ['chuo'], opts());
    await mkdir(path.join(dest, 'chuo'), { recursive: true });
    await writeFile(path.join(dest, 'chuo', 'stale'), 'old');
    const before = await readFile(path.join(data, 'chuo', 'snapshot.json'));
    expect(await restoreSnapshots(store, ['chuo'], { ...opts(), dest })).toEqual({ ids: 1, files: 2, bytes: 17 });
    for (const file of ['a.txt', 'nested/b.bin'])
      expect(await readFile(path.join(dest, 'chuo', file))).toEqual(await readFile(path.join(sources, 'chuo', file)));
    expect(await readdir(path.join(dest, 'chuo'))).toEqual(['a.txt', 'nested']);
    expect(await readFile(path.join(data, 'chuo', 'snapshot.json'))).toEqual(before);
  });
  it.each(['hash', 'size', 'missing'])('破損や欠落を拒否し、旧ディレクトリを保持する（%s）', async (mode) => {
    await archiveSnapshots(store, ['chuo'], opts());
    await mkdir(path.join(dest, 'chuo'), { recursive: true });
    await writeFile(path.join(dest, 'chuo', 'old'), 'keep');
    if (mode === 'missing') store.objects.delete(`${prefix}/a.txt`);
    else store.objects.set(`${prefix}/a.txt`, { bytes: Buffer.alloc(mode === 'hash' ? 13 : 1), sha256: '' });
    await expect(restoreSnapshots(store, ['chuo'], { ...opts(), dest })).rejects.toThrow(
      mode === 'missing' ? 'missing:' : 'sha256またはsize',
    );
    expect(await readdir(path.join(dest, 'chuo'))).toEqual(['old']);
    expect(await readFile(path.join(dest, 'chuo', 'old'), 'utf8')).toBe('keep');
    expect((await readdir(dest)).filter((name) => name.startsWith('.chuo-new-'))).toHaveLength(1);
  });
  it.each([
    '../escape',
    '/absolute',
    'C:/escape',
    'a/../../escape',
    'a\\..\\escape',
    'a:stream',
    'a/./b',
    'a//b',
    'CON.txt',
    'a.',
  ])('危険なパスを拒否する（%s）', async (name) => {
    const bytes = Buffer.from(JSON.stringify({ fetchedOn: date, files: { [name]: { sha256: 'a'.repeat(64), size: 0 } } }));
    store.objects.set(`${prefix}/snapshot.json`, { bytes, sha256: sha256(bytes) });
    await expect(restoreSnapshots(store, ['chuo'], { ...opts(), dest })).rejects.toThrow('安全な相対POSIXパス');
    await expect(readdir(dest)).rejects.toThrow();
  });
  it('取得日が一致しないマニフェストを拒否する', async () => {
    await archiveSnapshots(store, ['chuo'], opts());
    const manifest = await createManifest(path.join(sources, 'chuo'), '2026-10-23');
    store.objects.set(`${prefix}/snapshot.json`, { bytes: Buffer.from(JSON.stringify(manifest)), sha256: '' });
    await expect(restoreSnapshots(store, ['chuo'], { ...opts(), dest })).rejects.toThrow('取得日が一致しません');
  });
  it.each([true, false])('過去日付の指定はsourcesへの復元時だけマニフェストも更新する（sources=%s）', async (useSources) => {
    await archiveSnapshots(store, ['chuo'], opts());
    const local = await createManifest(path.join(sources, 'chuo'), '2026-10-23');
    await writeJson('snapshot.json', path.join(data, 'chuo', 'snapshot.json'), local);
    await archiveSnapshots(store, ['chuo'], opts());
    const lines: string[] = [];
    await restoreSnapshots(store, [`chuo@${date}`], {
      ...opts(),
      dest: useSources ? sources : dest,
      log: (line) => lines.push(line),
    });
    const actual = parseJson(await readFile(path.join(data, 'chuo', 'snapshot.json'), 'utf8'), 'snapshot.json');
    expect(actual.fetchedOn).toBe(useSources ? date : '2026-10-23');
    expect(lines.some((line) => line.includes('snapshot.json を更新しました'))).toBe(useSources);
  });
});

describe('取得時の置換とマニフェスト', () => {
  it('新しい取得一式だけを残し、以前の不要ファイルを混ぜない', async () => {
    await fetchSnapshot(
      'chuo',
      async (dir) => {
        for (const file of ['list.xlsx', 'vacancy.pdf', 'vacancy_page.html', 'kigyo_page.html', 'facility-pdfs/1.pdf']) {
          await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
          await writeFile(path.join(dir, file), 'new');
        }
      },
      { sources, data, fetchedOn: date, log: quiet, discardUnarchived: ['chuo'] },
    );
    expect(await readdir(path.join(sources, 'chuo'))).not.toContain('a.txt');
    expect(Object.keys(await loadVerifiedSnapshots(['chuo'], sources, data))).toEqual(['chuo']);
  });
  it('ダウンロード失敗時は旧ファイルとマニフェストを保持する', async () => {
    const before = await readFile(path.join(data, 'chuo', 'snapshot.json'));
    await expect(
      fetchSnapshot(
        'chuo',
        async (dir) => {
          await writeFile(path.join(dir, 'partial'), 'new');
          throw new Error('download failed');
        },
        { sources, data, discardUnarchived: ['chuo'] },
      ),
    ).rejects.toThrow('download failed');
    expect(await readFile(path.join(sources, 'chuo', 'a.txt'), 'utf8')).toBe('一次情報\n');
    expect(await readFile(path.join(data, 'chuo', 'snapshot.json'))).toEqual(before);
    expect((await readdir(sources)).filter((name) => name.startsWith('.chuo-new-'))).toHaveLength(1);
  });
  it('置換後のマニフェスト更新が失敗したら旧ディレクトリに戻す', async () => {
    await expect(
      replaceDirectory(path.join(sources, 'chuo'), async (dir) => {
        await writeFile(path.join(dir, 'fresh'), 'new');
        return {
          commit: async () => {
            throw new Error('commit failed');
          },
          cleanup: async () => {},
        };
      }),
    ).rejects.toThrow('commit failed');
    expect(await readFile(path.join(sources, 'chuo', 'a.txt'), 'utf8')).toBe('一次情報\n');
  });
  it('マニフェストは未知のフィールドと不正な値を拒否する', () => {
    const file = { sha256: 'a'.repeat(64), size: 0 };
    for (const value of [
      { fetchedOn: date, files: { a: file }, extra: true },
      { fetchedOn: date, files: { a: { ...file, extra: true } } },
      { fetchedOn: '2026/10/22', files: { a: file } },
      { fetchedOn: date, files: { a: { ...file, size: -1 } } },
      { fetchedOn: date, files: { a: { ...file, sha256: 'bad' } } },
      { fetchedOn: date, files: { a: file, A: file } },
      { fetchedOn: date, files: { a: file, 'a/b': file } },
    ])
      expect(v.safeParse(SnapshotSchema, value).success).toBe(false);
  });
  it('取得日はUTCではなくJSTで判定する', () => {
    expect(jstDate(new Date('2026-10-22T15:00:00Z'))).toBe('2026-10-23');
  });
});

describe('R2ストレージの境界', () => {
  it('5xxとネットワーク障害はバックオフで再試行する', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new StorageError(503, 'unavailable'))
      .mockResolvedValue('ok');
    const delays: number[] = [];
    expect(
      await withRetry(operation, async (ms) => {
        delays.push(ms);
      }),
    ).toBe('ok');
    expect(delays).toEqual([250, 500]);
  });
  it('4xxは再試行せず、繰り返す5xxは上限で止める', async () => {
    const forbidden = vi.fn().mockRejectedValue(new StorageError(403, 'forbidden'));
    await expect(withRetry(forbidden, async () => {})).rejects.toThrow('forbidden');
    expect(forbidden).toHaveBeenCalledTimes(1);
    const broken = vi.fn().mockRejectedValue(new StorageError(500, 'broken'));
    await expect(withRetry(broken, async () => {})).rejects.toThrow('broken');
    expect(broken).toHaveBeenCalledTimes(4);
  });
  it('不足する環境変数名とREADMEを案内する', () => {
    for (const name of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) vi.stubEnv(name, '');
    expect(() => createR2Storage()).toThrow('R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET');
    expect(() => createR2Storage()).toThrow('README');
  });
  it('署名・sha256メタデータ・条件付きPUT・エンコードしたキーを送る', async () => {
    vi.stubEnv('R2_ACCOUNT_ID', 'a'.repeat(32));
    vi.stubEnv('R2_ACCESS_KEY_ID', 'test-key');
    vi.stubEnv('R2_SECRET_ACCESS_KEY', 'test-secret');
    vi.stubEnv('R2_BUCKET', 'test-bucket');
    const requests: Request[] = [];
    vi.stubGlobal('fetch', async (request: Request) => {
      requests.push(request);
      return new Response(null, { status: 200 });
    });
    const storage = createR2Storage();
    await storage.put('snapshots/chuo/2026-10-22/日本語 #%.txt', Buffer.from('abc'), 'a'.repeat(64));
    expect(requests).toHaveLength(1);
    expect(requests[0].headers.get('if-none-match')).toBe('*');
    expect(requests[0].headers.get('x-amz-meta-sha256')).toBe('a'.repeat(64));
    expect(requests[0].headers.get('authorization')).toContain('/auto/s3/aws4_request');
    expect(requests[0].url).toContain('%E6%97%A5%E6%9C%AC%E8%AA%9E%20%23%25.txt');
    expect(await requests[0].text()).toBe('abc');
  });
});
