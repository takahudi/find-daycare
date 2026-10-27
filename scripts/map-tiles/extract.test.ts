import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { Compression, PMTiles, TileType } from 'pmtiles';
import type { Source } from 'pmtiles';
import { afterEach, expect, it, vi } from 'vitest';
import { parseJson } from '../json.ts';
import { MAP_AREA } from './config.ts';
import { extractMapTiles, extractTiles, ProtomapsSource, tileCoordinates } from './extract.ts';
import { writePMTiles } from './pmtiles-writer.ts';

const roots: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const header = { bounds: MAP_AREA.bbox, minZoom: 0, maxZoom: 15, tileType: TileType.Mvt, tileCompression: Compression.Gzip };
const metadata = { version: '4.15.2', vector_layers: [], attribution: 'test attribution' };
const coordinates = Array.from({ length: 16 }, (_, z) => tileCoordinates(z)).flat();
const tiles = coordinates.map(({ z, tileId }) => ({ tileId, bytes: gzipSync(`tile z${z}`) }));
function sourceFor(bytes: Uint8Array): Source {
  return {
    getKey: () => 'memory',
    getBytes: async (offset, length) => ({ data: Uint8Array.from(bytes.subarray(offset, offset + length)).buffer }),
  };
}
function rangeResponse(file: Uint8Array, options?: RequestInit, { status = 206, etag = '"build-a"' } = {}) {
  const [, start, to] = new Headers(options?.headers).get('range')!.match(/^bytes=(\d+)-(\d+)$/)!;
  const from = Number(start);
  const end = Math.min(Number(to), file.length - 1);
  return new Response(Buffer.from(file.subarray(from, end + 1)), {
    status,
    headers: { ETag: etag, 'Content-Range': `bytes ${from}-${end}/${file.length}` },
  });
}
const remote = Buffer.alloc(1000, 'o');

it('大阪市のbboxにかかるタイルは各ズームの期待枚数となり、全体で877枚になる', () => {
  const counts = Array.from({ length: 16 }, (_, z) => tileCoordinates(z).length);
  expect(counts).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 6, 16, 49, 169, 625]);
  expect(counts.reduce((sum, count) => sum + count, 0)).toBe(877);
});

it('内部圧縮がgzipの元ファイルから、全座標のタイルの元バイト列とメタデータを切り出す', async () => {
  const original = Buffer.from(writePMTiles(tiles, header, metadata));
  const offset = (at: number) => Number(original.readBigUInt64LE(at));
  const root = gzipSync(original.subarray(offset(8), offset(8) + offset(16)));
  const json = gzipSync(original.subarray(offset(24), offset(24) + offset(32)));
  const data = original.subarray(offset(56));
  const compressedHeader = Buffer.from(original.subarray(0, 127));
  for (const [at, value] of [
    [16, root.length],
    [24, 127 + root.length],
    [32, json.length],
    [40, 127 + root.length + json.length],
    [56, 127 + root.length + json.length],
  ])
    compressedHeader.writeBigUInt64LE(BigInt(value), at);
  compressedHeader[97] = Compression.Gzip;
  const result = await extractTiles(sourceFor(Buffer.concat([compressedHeader, root, json, data])));
  expect(result.tiles).toBe(877);
  expect(result.tilesVersion).toBe('4.15.2');
  const reader = new PMTiles(sourceFor(result.bytes), undefined, async (bytes) => bytes);
  for (const { z, x, y } of coordinates) {
    expect(new Uint8Array((await reader.getZxy(z, x, y))!.data)).toEqual(new Uint8Array(gzipSync(`tile z${z}`)));
  }
  expect(await reader.getMetadata()).toEqual(metadata);
});

it.each([{ tileType: TileType.Png }, { tileCompression: Compression.None }, { minZoom: 1 }, { maxZoom: 14 }])(
  '対応しない元ヘッダ%sはタイルを取得する前に拒否する',
  async (change) => {
    const source = sourceFor(writePMTiles(tiles, { ...header, ...change }, metadata));
    const getBytes = vi.spyOn(source, 'getBytes');
    await expect(extractTiles(source)).rejects.toThrow('MVT・gzip・minZoom 0・maxZoom');
    expect(getBytes).toHaveBeenCalledTimes(1);
  },
);

it('範囲内に3枚だけある元ファイルは失敗し、欠けた座標は先頭5件だけを表示する', async () => {
  const sparse = [0, 1, 15].map((z) => tiles.find((tile) => tile.tileId === tileCoordinates(z)[0].tileId)!);
  const missing = coordinates.filter(({ tileId }) => !sparse.some((tile) => tile.tileId === tileId));
  await expect(extractTiles(sourceFor(writePMTiles(sparse, header, metadata)))).rejects.toThrow(
    new Error(
      `範囲内のタイルが874枚欠けています: ${missing
        .slice(0, 5)
        .map(({ z, x, y }) => `${z}/${x}/${y}`)
        .join(', ')}`,
    ),
  );
});

it('元メタデータのキーの並びを書き出したファイルでも保つ', async () => {
  const sourceMetadata = { attribution: 'test attribution', name: 'test map', vector_layers: [], version: '4.15.2' };
  const result = await extractTiles(sourceFor(writePMTiles(tiles, header, sourceMetadata)));
  const reader = new PMTiles(sourceFor(result.bytes));
  expect(JSON.stringify(await reader.getMetadata())).toBe(JSON.stringify(sourceMetadata));
});

it('元メタデータにversionがなければ推測せず停止する', async () => {
  const source = sourceFor(writePMTiles(tiles, header, { vector_layers: [] }));
  await expect(extractTiles(source)).rejects.toThrow('version');
});

it('Range取得の5xx・429・ネットワーク障害を再試行して復旧する', async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(new Response(null, { status: 429 }))
    .mockRejectedValueOnce(new TypeError('fetch failed'))
    .mockImplementationOnce(async (_url: string, options: RequestInit) => rangeResponse(remote, options));
  vi.stubGlobal('fetch', fetch);
  const result = new ProtomapsSource('https://build.protomaps.com/20261027.pmtiles').getBytes(100, 2);
  await vi.runAllTimersAsync();
  expect(Buffer.from((await result).data).toString()).toBe('oo');
  expect(fetch).toHaveBeenCalledTimes(4);
  for (const [, options] of fetch.mock.calls) expect(options.headers.get('range')).toBe('bytes=100-101');
});

it.each([200, 403, 404, 412, 429, 503])('206以外の%sはボディをcancelし、429と5xxだけ再試行する', async (status) => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const fetch = vi.fn(async () => new Response(new ReadableStream({ cancel }), { status }));
  vi.stubGlobal('fetch', fetch);
  const assertion = expect(
    new ProtomapsSource('https://build.protomaps.com/20261027.pmtiles').getBytes(0, 127),
  ).rejects.toThrow();
  await vi.runAllTimersAsync();
  await assertion;
  const attempts = status === 429 || status === 503 ? 4 : 1;
  expect(fetch).toHaveBeenCalledTimes(attempts);
  expect(cancel).toHaveBeenCalledTimes(attempts);
});

it('最初のヘッダ取得が404なら新しいbuildの指定方法を案内する', async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 404 }));
  vi.stubGlobal('fetch', fetch);
  await expect(extractTiles(new ProtomapsSource('https://build.protomaps.com/20261027.pmtiles'))).rejects.toThrow(
    'そのbuildはbuild.protomaps.comにもうありません。--build YYYYMMDDで新しいbuildを指定してください',
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('最初のETagを以後のIf-Matchに付け、Range要求ごとに120秒の上限を使う', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, options) => rangeResponse(remote, options));
  vi.stubGlobal('fetch', fetch);
  const timeout = vi.spyOn(AbortSignal, 'timeout');
  const source = new ProtomapsSource('https://build.protomaps.com/20261027.pmtiles');
  await source.getBytes(0, 2);
  const result = await source.getBytes(100, 2);
  expect(result.etag).toBe('"build-a"');
  expect(Buffer.from(result.data).toString()).toBe('oo');
  expect(new Headers(fetch.mock.calls[0][1]?.headers).get('if-match')).toBeNull();
  expect(new Headers(fetch.mock.calls[1][1]?.headers).get('if-match')).toBe('"build-a"');
  expect(new Headers(fetch.mock.calls[1][1]?.headers).get('range')).toBe('bytes=100-101');
  expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([120_000, 120_000]);
});

it.each([
  ['"build-b"', 'ETagが変わりました'],
  [null, '強いETagがない'],
])('取得途中のETagが%sに変わればボディをcancelし、再試行しない', async (etag, message) => {
  const cancel = vi.fn();
  const fetch = vi
    .fn()
    .mockImplementationOnce(async (_url: string, options: RequestInit) => rangeResponse(remote, options))
    .mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status: 206, headers: etag ? { ETag: etag } : {} }));
  vi.stubGlobal('fetch', fetch);
  const source = new ProtomapsSource('https://build.protomaps.com/20261027.pmtiles');
  await source.getBytes(0, 2);
  await expect(source.getBytes(100, 2)).rejects.toThrow(message);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(cancel).toHaveBeenCalledTimes(1);
});

it.each([null, 'W/"build-a"'])('最初の応答のETagが%sなら版を固定できないので、再試行せず止める', async (etag) => {
  const cancel = vi.fn();
  const fetch = vi.fn(
    async () => new Response(new ReadableStream({ cancel }), { status: 206, headers: etag ? { ETag: etag } : {} }),
  );
  vi.stubGlobal('fetch', fetch);
  await expect(new ProtomapsSource('https://build.protomaps.com/20261027.pmtiles').getBytes(0, 2)).rejects.toThrow(
    '強いETagがない',
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalledTimes(1);
});

it.each([
  ['bytes 101-102/1000', 2],
  ['bytes 100-100/1000', 1],
  [null, 2],
])('Content-Rangeが%sで本文が%i バイトの応答は、要求と違うので再試行せず止める', async (contentRange, size) => {
  const fetch = vi.fn(
    async () =>
      new Response(Buffer.alloc(size), {
        status: 206,
        headers: { ETag: '"build-a"', ...(contentRange ? { 'Content-Range': contentRange } : {}) },
      }),
  );
  vi.stubGlobal('fetch', fetch);
  await expect(new ProtomapsSource('https://build.protomaps.com/20261027.pmtiles').getBytes(100, 2)).rejects.toThrow(
    '要求した範囲と異なる応答です',
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('ファイルの末尾で要求より短い応答は、Content-Rangeが末尾を指すときだけ受け付ける', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options: RequestInit) => rangeResponse(remote, options)),
  );
  const result = await new ProtomapsSource('https://build.protomaps.com/20261027.pmtiles').getBytes(990, 100);
  expect(result.data.byteLength).toBe(10);
});

it.each([206, 412])('タイル取得中に版の変更を%sで受け取ったらヘッダを再取得せず抽出全体を失敗させる', async (status) => {
  const original = writePMTiles(tiles, header, metadata);
  let requests = 0;
  const fetch = vi.fn(async (_url: string, options: RequestInit) => {
    requests++;
    const changed = requests > 2;
    return rangeResponse(original, options, changed ? { status, etag: '"build-b"' } : {});
  });
  vi.stubGlobal('fetch', fetch);
  await expect(extractTiles(new ProtomapsSource('https://build.protomaps.com/20261027.pmtiles'))).rejects.toThrow(
    'ETagが変わりました',
  );
  expect(
    fetch.mock.calls.filter(([, options]) => new Headers(options.headers).get('range')!.startsWith('bytes=0-')),
  ).toHaveLength(1);
  for (const [, options] of fetch.mock.calls.slice(1)) expect(new Headers(options.headers).get('if-match')).toBe('"build-a"');
});

it('buildを省くと記録から同じファイルを再生成し、出力のハッシュとサイズを記録する', async () => {
  const original = writePMTiles(tiles, header, metadata);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options: RequestInit) => rangeResponse(original, options)),
  );
  const root = await mkdtemp(path.join(tmpdir(), 'map-extract-'));
  roots.push(root);
  const options = { root, log: vi.fn() };
  const first = await extractMapTiles('20261027', options);
  const firstBytes = await readFile(path.join(root, 'map-tiles/osaka-20261027.pmtiles'));
  const second = await extractMapTiles(undefined, options);
  expect(first).toEqual(second);
  expect(first.object.size).toBe(firstBytes.length);
  expect(await readFile(path.join(root, 'map-tiles/osaka-20261027.pmtiles'))).toEqual(firstBytes);
  expect(parseJson(await readFile(path.join(root, 'data/map/tiles.json'), 'utf8'), 'tiles.json')).toEqual(first);
});

it('buildも記録もない場合や8桁以外のbuildでは通信しない', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'map-extract-'));
  roots.push(root);
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await expect(extractMapTiles(undefined, { root })).rejects.toThrow('--build');
  for (const build of ['2026-10-27', '../20261027', '2026102', '202610270'])
    await expect(extractMapTiles(build, { root })).rejects.toThrow('8桁');
  expect(fetch).not.toHaveBeenCalled();
});
