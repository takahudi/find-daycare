import { AwsV4Signer } from 'aws4fetch';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createR2Storage } from '../snapshot-storage.ts';
import { sha256 } from '../snapshots.ts';
import { MAP_R2_ENVIRONMENT } from './config.ts';

beforeEach(() => {
  vi.stubEnv('R2_ACCOUNT_ID', 'a'.repeat(32));
  vi.stubEnv('R2_ACCESS_KEY_ID', 'source-key');
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'source-secret');
  vi.stubEnv('R2_BUCKET', 'source-bucket');
  vi.stubEnv('R2_MAP_ACCESS_KEY_ID', 'map-key');
  vi.stubEnv('R2_MAP_SECRET_ACCESS_KEY', 'map-secret');
  vi.stubEnv('R2_MAP_BUCKET', 'map-bucket');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('地図の認証情報とバケットを使い、条件付きPUTにsha256を付ける', async () => {
  const requests: Request[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    requests.push(request);
    return new Response(null, { headers: { 'x-amz-meta-sha256': 'stored-hash' } });
  });
  const bytes = Buffer.from('map');
  const hash = sha256(bytes);
  const storage = createR2Storage(MAP_R2_ENVIRONMENT);
  await storage.put('tiles/osaka-20261027.pmtiles', bytes, hash);
  const request = requests[0];
  expect(request.url).toBe(`https://${'a'.repeat(32)}.r2.cloudflarestorage.com/map-bucket/tiles/osaka-20261027.pmtiles`);
  expect(request.headers.get('if-none-match')).toBe('*');
  expect(request.headers.get('x-amz-meta-sha256')).toBe(hash);
  const signer = new AwsV4Signer({
    url: request.url,
    method: request.method,
    headers: request.headers,
    body: bytes,
    accessKeyId: 'map-key',
    secretAccessKey: 'map-secret',
    service: 's3',
    region: 'auto',
    datetime: request.headers.get('x-amz-date') ?? undefined,
  });
  expect(await signer.authHeader()).toBe(request.headers.get('authorization'));
  expect(await storage.head('tiles/osaka-20261027.pmtiles')).toEqual({ sha256: 'stored-hash' });
});

it('引数がなければ一次情報の認証情報とバケットを使う', async () => {
  const requests: Request[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    requests.push(request);
    return new Response(null, { status: 404 });
  });
  await createR2Storage().head('snapshots/chuo/test');
  expect(requests[0].url).toBe(`https://${'a'.repeat(32)}.r2.cloudflarestorage.com/source-bucket/snapshots/chuo/test`);
  expect(requests[0].headers.get('authorization')).toContain('Credential=source-key/');
});

it('地図の認証情報が欠けた場合に一次情報の認証情報へフォールバックしない', () => {
  vi.stubEnv('R2_MAP_SECRET_ACCESS_KEY', '');
  expect(() => createR2Storage(MAP_R2_ENVIRONMENT)).toThrow('R2_MAP_SECRET_ACCESS_KEY');
});
