import { get } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import manifest from '../data/map/tiles.json' with { type: 'json' };
import { fixtureTiles } from '../scripts/map-tiles/tile-fixture.ts';

const tilePath = (z: number, x: number, y: number) => `/map/tiles/${manifest.source.build}/${z}/${x}/${y}.mvt`;
const expectedHeaders = {
  'content-type': 'application/vnd.mapbox-vector-tile',
  'cache-control': 'public, max-age=31536000, immutable',
  'x-content-type-options': 'nosniff',
  'cross-origin-resource-policy': 'same-origin',
};

for (const tile of fixtureTiles) {
  test(`${tile.z}/${tile.x}/${tile.y}はgzipのMVTを二重圧縮せず配信する`, async ({ baseURL }) => {
    const { status, headers, bytes } = await new Promise<{
      status: number | undefined;
      headers: import('node:http').IncomingHttpHeaders;
      bytes: Buffer;
    }>((resolve, reject) => {
      get(new URL(tilePath(tile.z, tile.x, tile.y), baseURL), { headers: { 'Accept-Encoding': 'gzip' } }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks) }),
        );
        response.on('error', reject);
      }).on('error', reject);
    });
    expect(status).toBe(200);
    expect(headers).toMatchObject({
      ...expectedHeaders,
      'content-encoding': 'gzip',
      etag: `"${manifest.object.sha256}-${tile.z}-${tile.x}-${tile.y}"`,
    });
    expect(Object.keys(headers).some((name) => name.startsWith('access-control-'))).toBe(false);
    expect(bytes).toEqual(tile.bytes);
    expect(gunzipSync(bytes)).toEqual(Buffer.from(tile.mvt));
  });
}

test('HEADと304は本文を返さず、ないタイルは204、不明なbuildは404を返す', async ({ request }) => {
  const path = tilePath(0, 0, 0);
  const head = await request.head(path);
  expect(head.status()).toBe(200);
  expect(head.headers()).toMatchObject({ ...expectedHeaders, 'content-encoding': 'gzip' });
  expect(await head.body()).toHaveLength(0);
  const cached = await request.get(path, { headers: { 'If-None-Match': head.headers().etag } });
  expect(cached.status()).toBe(304);
  expect(cached.headers()).toMatchObject(expectedHeaders);
  expect(await cached.body()).toHaveLength(0);
  const missing = await request.get(tilePath(1, 0, 1));
  expect(missing.status()).toBe(204);
  expect(missing.headers()).toMatchObject(expectedHeaders);
  expect(await missing.body()).toHaveLength(0);
  const unknown = await request.get('/map/tiles/unknown/0/0/0.mvt');
  expect(unknown.status()).toBe(404);
  expect(unknown.headers()['cache-control']).toBe('no-store');
  const post = await request.post(path);
  expect(post.status()).toBe(405);
  expect(post.headers().allow).toBe('GET, HEAD');
});
