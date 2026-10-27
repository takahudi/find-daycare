import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { Compression, PMTiles, TileType } from 'pmtiles';
import type { Source } from 'pmtiles';
import { afterEach, expect, it, vi } from 'vitest';
import { parseJson } from '../json.ts';
import { MAP_AREA } from './config.ts';
import { extractMapTiles, extractTiles, RetryFetchSource, tileCoordinates } from './extract.ts';
import { writePMTiles } from './pmtiles-writer.ts';

const roots: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const header = { bounds: MAP_AREA.bbox, minZoom: 0, maxZoom: 15, tileType: TileType.Mvt, tileCompression: Compression.Gzip };
const metadata = { version: '4.15.2', vector_layers: [], attribution: 'test attribution' };
const tiles = [0, 1, 15].map((z) => ({ tileId: tileCoordinates(z)[0].tileId, bytes: gzipSync(`tile z${z}`) }));
function sourceFor(bytes: Uint8Array): Source {
  return {
    getKey: () => 'memory',
    getBytes: async (offset, length) => ({ data: Uint8Array.from(bytes.subarray(offset, offset + length)).buffer }),
  };
}

it('大阪市のbboxにかかるタイルは各ズームの期待枚数となり、全体で877枚になる', () => {
  const counts = Array.from({ length: 16 }, (_, z) => tileCoordinates(z).length);
  expect(counts).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 6, 16, 49, 169, 625]);
  expect(counts.reduce((sum, count) => sum + count, 0)).toBe(877);
});

it('内部圧縮がgzipの元ファイルから、存在するタイルの元バイト列とメタデータを切り出す', async () => {
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
  expect(result.tiles).toBe(3);
  expect(result.tilesVersion).toBe('4.15.2');
  const reader = new PMTiles(sourceFor(result.bytes), undefined, async (bytes) => bytes);
  for (const z of [0, 1, 15]) {
    const { x, y } = tileCoordinates(z)[0];
    expect(new Uint8Array((await reader.getZxy(z, x, y))!.data)).toEqual(new Uint8Array(gzipSync(`tile z${z}`)));
  }
  expect(await reader.getMetadata()).toEqual(metadata);
});

it.each([{ tileType: TileType.Png }, { tileCompression: Compression.None }, { maxZoom: 14 }])(
  '対応しない元ヘッダ%sはタイルを取得する前に拒否する',
  async (change) => {
    const source = sourceFor(writePMTiles(tiles, { ...header, ...change }, metadata));
    const getBytes = vi.spyOn(source, 'getBytes');
    await expect(extractTiles(source)).rejects.toThrow('MVT・gzip・maxZoom');
    expect(getBytes).toHaveBeenCalledTimes(1);
  },
);

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

it('Range取得の5xxとネットワーク障害を再試行して復旧する', async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockRejectedValueOnce(new TypeError('fetch failed'))
    .mockResolvedValueOnce(new Response('ok', { status: 206 }));
  vi.stubGlobal('fetch', fetch);
  const result = new RetryFetchSource('https://build.protomaps.com/20261027.pmtiles').getBytes(100, 2);
  await vi.runAllTimersAsync();
  expect(Buffer.from((await result).data).toString()).toBe('ok');
  expect(fetch).toHaveBeenCalledTimes(3);
  for (const [, options] of fetch.mock.calls) expect(options.headers.get('range')).toBe('bytes=100-101');
});

it('Range取得の403は再試行しない', async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 403 }));
  vi.stubGlobal('fetch', fetch);
  await expect(new RetryFetchSource('https://build.protomaps.com/20261027.pmtiles').getBytes(0, 127)).rejects.toThrow('403');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('buildを省くと記録から同じファイルを再生成し、出力のハッシュとサイズを記録する', async () => {
  const original = writePMTiles(tiles, header, metadata);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options: RequestInit) => {
      const range = new Headers(options.headers).get('range')!.match(/^bytes=(\d+)-(\d+)$/)!;
      return new Response(Buffer.from(original.subarray(Number(range[1]), Number(range[2]) + 1)), { status: 206 });
    }),
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
