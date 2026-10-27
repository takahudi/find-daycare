import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { bytesToHeader, Compression } from 'pmtiles';
import { afterEach, expect, it, vi } from 'vitest';
import manifest from '../../data/map/tiles.json' with { type: 'json' };
import { serveTile } from '../../worker/tiles.ts';
import type { TileBucket } from '../../worker/tiles.ts';
import { createTileFixture, fixtureTiles } from './tile-fixture.ts';

const tilePath = (z = 0, x = 0, y = 0) => `/map/tiles/${manifest.source.build}/${z}/${x}/${y}.mvt`;
const request = (path = tilePath(), init?: RequestInit) => new Request(`https://example.test${path}`, init);
const cacheHeaders = {
  'content-type': 'application/vnd.mapbox-vector-tile',
  'cache-control': 'public, max-age=31536000, immutable',
  'x-content-type-options': 'nosniff',
  'cross-origin-resource-policy': 'same-origin',
};

function fakeBucket(bytes = createTileFixture()) {
  const get = vi.fn<TileBucket['get']>(async (_key, { range }) => ({
    size: bytes.length,
    arrayBuffer: async () => Uint8Array.from(bytes.subarray(range.offset, range.offset + range.length)).buffer,
  }));
  return { bytes, get };
}

afterEach(() => vi.restoreAllMocks());

it('200は元のgzipバイト列と配信ヘッダを返し、CORSは許可しない', async () => {
  const bucket = fakeBucket();
  for (const tile of fixtureTiles) {
    const response = await serveTile(request(tilePath(tile.z, tile.x, tile.y)), bucket);
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toMatchObject({ ...cacheHeaders, 'content-encoding': 'gzip' });
    expect([...response.headers.keys()].some((name) => name.startsWith('access-control-'))).toBe(false);
    expect(response.headers.get('etag')).toBe(`"${manifest.object.sha256}-${tile.z}-${tile.x}-${tile.y}"`);
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes).toEqual(tile.bytes);
    expect(gunzipSync(bytes)).toEqual(Buffer.from(tile.mvt));
  }
});

it('HEADはGETと同じヘッダとステータスで本文を返さない', async () => {
  const bucket = fakeBucket();
  const get = await serveTile(request(), bucket);
  const head = await serveTile(request(tilePath(), { method: 'HEAD' }), bucket);
  expect(head.status).toBe(get.status);
  expect([...head.headers]).toEqual([...get.headers]);
  expect(await head.text()).toBe('');
});

it.each(['exact', 'list', 'weak', 'wildcard'])('If-None-Matchの%sの一致では304と空の本文を返す', async (kind) => {
  const bucket = fakeBucket();
  const etag = (await serveTile(request(), bucket)).headers.get('etag')!;
  const values: Record<string, string> = { exact: etag, list: `"other", ${etag}`, weak: `W/${etag}`, wildcard: '*' };
  const response = await serveTile(request(tilePath(), { headers: { 'If-None-Match': values[kind] } }), bucket);
  expect(response.status).toBe(304);
  expect(Object.fromEntries(response.headers)).toMatchObject({ ...cacheHeaders, etag });
  expect(await response.text()).toBe('');
});

it('一致しないIf-None-Matchには200を返す', async () => {
  expect((await serveTile(request(tilePath(), { headers: { 'If-None-Match': '"other"' } }), fakeBucket())).status).toBe(200);
});

it.each(['GET', 'HEAD'])('範囲内のないタイルは%sで204とキャッシュヘッダと空の本文を返す', async (method) => {
  const response = await serveTile(request(tilePath(1, 0, 1), { method }), fakeBucket());
  expect(response.status).toBe(204);
  expect(Object.fromEntries(response.headers)).toMatchObject(cacheHeaders);
  expect(response.headers.get('etag')).toBe(`"${manifest.object.sha256}-1-0-1"`);
  expect(response.headers.has('content-encoding')).toBe(false);
  expect(await response.text()).toBe('');
});

it.each(['GET', 'HEAD'])('ないタイルでも%sのETagが一致すればR2を読まず304を返す', async (method) => {
  const bucket = fakeBucket();
  const path = tilePath(1, 0, 1);
  const missing = await serveTile(request(path), bucket);
  expect(missing.status).toBe(204);
  const etag = missing.headers.get('etag')!;
  bucket.get.mockClear();
  const response = await serveTile(request(path, { method, headers: { 'If-None-Match': etag } }), bucket);
  expect(response.status).toBe(304);
  expect(Object.fromEntries(response.headers)).toMatchObject({ ...cacheHeaders, etag });
  expect(await response.text()).toBe('');
  expect(bucket.get).not.toHaveBeenCalled();
});

it.each(['GET', 'HEAD'])('R2が読めなくても%sのETagが一致すればR2を読まず304を返す', async (method) => {
  const bucket = fakeBucket();
  bucket.get.mockRejectedValue(new Error('R2 unavailable'));
  const etag = `"${manifest.object.sha256}-0-0-0"`;
  const response = await serveTile(request(tilePath(), { method, headers: { 'If-None-Match': etag } }), bucket);
  expect(response.status).toBe(304);
  expect(Object.fromEntries(response.headers)).toMatchObject({ ...cacheHeaders, etag });
  expect(await response.text()).toBe('');
  expect(bucket.get).not.toHaveBeenCalled();
});

it.each([
  '/map/tiles/bad/0/0/0.mvt',
  tilePath().replace('.mvt', '.png'),
  tilePath() + '/extra',
  tilePath(-1),
  tilePath(manifest.maxZoom + 1),
  tilePath(0, 1),
  tilePath(0, 0, 1),
  tilePath(1, -1),
  tilePath(1, 0, -1),
  tilePath().replace('/0/0/0', '/00/0/0'),
  tilePath().replace('/0/0/0', '/0.5/0/0'),
  tilePath(15, Number.MAX_SAFE_INTEGER + 1),
])('%sはR2を読まずキャッシュさせない404を返す', async (path) => {
  const bucket = fakeBucket();
  const response = await serveTile(request(path), bucket);
  expect(response.status).toBe(404);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(bucket.get).not.toHaveBeenCalled();
});

it.each(['POST', 'PUT', 'DELETE', 'OPTIONS'])('%sは405とAllowを返しR2を読まない', async (method) => {
  const bucket = fakeBucket();
  const response = await serveTile(request(tilePath(), { method }), bucket);
  expect(response.status).toBe(405);
  expect(response.headers.get('allow')).toBe('GET, HEAD');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(bucket.get).not.toHaveBeenCalled();
});

it.each(['missing', 'unreadable', 'truncated'])('R2が%sのとき503を記録しキャッシュせず、その後は復旧できる', async (kind) => {
  const bucket = fakeBucket();
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  if (kind === 'missing') bucket.get.mockResolvedValueOnce(null);
  else if (kind === 'unreadable') bucket.get.mockRejectedValueOnce(new Error('R2 unavailable'));
  else bucket.get.mockResolvedValueOnce({ size: 200, arrayBuffer: async () => new ArrayBuffer(1) });
  const response = await serveTile(request(), bucket);
  expect(response.status).toBe(503);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(error).toHaveBeenCalledWith('地図タイルをR2から読み取れませんでした', expect.any(Error));
  expect((await serveTile(request(), bucket)).status).toBe(200);
});

it.each([
  { part: 'ディレクトリ', offset: 97, compression: Compression.Gzip },
  { part: 'ディレクトリ', offset: 97, compression: Compression.Unknown },
  { part: 'タイル', offset: 98, compression: Compression.None },
  { part: 'タイル', offset: 98, compression: Compression.Brotli },
])('未対応の圧縮形式（$part、$compression）は503を記録しキャッシュしない', async ({ offset, compression }) => {
  const bytes = createTileFixture();
  bytes[offset] = compression;
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = await serveTile(request(), fakeBucket(bytes));
  expect(response.status).toBe(503);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.text()).toBe('');
  expect(error).toHaveBeenCalledWith('地図タイルをR2から読み取れませんでした', expect.any(Error));
});

it('R2からPMTilesの指定位置だけを読み、2回目にはヘッダとディレクトリを読み直さない', async () => {
  const bucket = fakeBucket();
  const header = bytesToHeader(Uint8Array.from(bucket.bytes.subarray(0, 127)).buffer);
  const first = fixtureTiles[0];
  const second = fixtureTiles[1];
  await serveTile(request(), bucket);
  expect(bucket.get.mock.calls).toEqual([
    [manifest.object.key, { range: { offset: 0, length: 16_384 } }],
    [manifest.object.key, { range: { offset: header.tileDataOffset, length: first.bytes.length } }],
  ]);
  bucket.get.mockClear();
  await serveTile(request(tilePath(second.z, second.x, second.y)), bucket);
  expect(bucket.get.mock.calls).toEqual([
    [manifest.object.key, { range: { offset: header.tileDataOffset + first.bytes.length, length: second.bytes.length } }],
  ]);
});

it('ソース設定はタイルだけを先にWorkerへ渡し地図のR2だけを結び付ける', async () => {
  const config = JSON.parse((await readFile('wrangler.jsonc', 'utf8')).replace(/,\s*([}\]])/g, '$1'));
  expect(config.main).toBe('worker/index.ts');
  expect(config.assets).toEqual({ binding: 'ASSETS', run_worker_first: ['/map/tiles/*'], not_found_handling: 'none' });
  expect(config.r2_buckets).toEqual([{ binding: 'MAP_TILES', bucket_name: 'find-daycare-map' }]);
});
