import { AwsV4Signer } from 'aws4fetch';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createR2Storage, createR2StorageIfConfigured } from './snapshot-storage.ts';
import { sha256 } from './snapshots.ts';

beforeEach(() => {
  vi.stubEnv('R2_ACCOUNT_ID', 'a'.repeat(32));
  vi.stubEnv('R2_ACCESS_KEY_ID', 'test-key');
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'test-secret');
  vi.stubEnv('R2_BUCKET', 'test-bucket');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('PUTの412をexistsとして返し、再試行しない', async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 412 }));
  vi.stubGlobal('fetch', fetch);
  expect(await createR2Storage().put('key', Buffer.from('abc'), sha256(Buffer.from('abc')))).toBe('exists');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('HEADの404をnullとして返し、再試行しない', async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 404 }));
  vi.stubGlobal('fetch', fetch);
  expect(await createR2Storage().head('key')).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('HEADはsha256メタデータを読む', async () => {
  const fetch = vi.fn(async () => new Response(null, { headers: { 'x-amz-meta-sha256': 'stored-hash' } }));
  vi.stubGlobal('fetch', fetch);
  expect(await createR2Storage().head('key')).toEqual({ sha256: 'stored-hash' });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([400, 403, 404, 429])('GETの%sは失敗し、再試行しない', async (status) => {
  const fetch = vi.fn(async () => new Response('denied', { status }));
  vi.stubGlobal('fetch', fetch);
  await expect(createR2Storage().get('key')).rejects.toThrow(`GET key: ${status}`);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(['head', 'put'] as const)('%sの403を再試行しない', async (method) => {
  const fetch = vi.fn(async () => new Response(null, { status: 403 }));
  vi.stubGlobal('fetch', fetch);
  const storage = createR2Storage();
  const result = method === 'head' ? storage.head('key') : storage.put('key', Buffer.from('abc'), sha256(Buffer.from('abc')));
  await expect(result).rejects.toThrow('403');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('GETは成功ボディを返す', async () => {
  const fetch = vi.fn(async () => new Response(Buffer.from([0, 255])));
  vi.stubGlobal('fetch', fetch);
  expect(await createR2Storage().get('key')).toEqual(new Uint8Array([0, 255]));
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('503は4回で打ち切る', async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  const assertion = expect(createR2Storage().get('key')).rejects.toThrow('GET key: 503');
  await assertion;
  expect(fetch).toHaveBeenCalledTimes(4);
});

it('一時的な503の後は取得できる', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(new Response('ok'));
  vi.stubGlobal('fetch', fetch);
  const result = createR2Storage().get('key');
  expect(Buffer.from(await result).toString()).toBe('ok');
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('資格情報が揃っていなければ取得時のR2接続を省略する', () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  vi.stubEnv('R2_SECRET_ACCESS_KEY', '');
  expect(createR2StorageIfConfigured()).toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();
});

it('括弧・空白・日本語を含むwire pathと署名のcanonical pathが一致する', async () => {
  const requests: Request[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    requests.push(request);
    return new Response(null, { status: 200 });
  });
  const bytes = Buffer.from('abc');
  const hash = sha256(bytes);
  await createR2Storage().put("snapshots/taisho/2026-10-22/homepage-sources/1/P22-R8-F(Tubame) 日本語!'*.pdf", bytes, hash);
  const request = requests[0];
  const signer = new AwsV4Signer({
    url: request.url,
    method: 'PUT',
    headers: request.headers,
    body: bytes,
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
    service: 's3',
    region: 'auto',
    datetime: request.headers.get('x-amz-date') ?? undefined,
  });
  const canonical = (await signer.canonicalString()).split('\n');
  expect(canonical[1]).toBe(new URL(request.url).pathname);
  expect(canonical.at(-1)).toBe(hash);
  expect(request.headers.get('x-amz-content-sha256')).toBe(hash);
  expect(await signer.authHeader()).toBe(request.headers.get('authorization'));
});

it.each(['UND_ERR_SOCKET', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'])(
  'GETのボディ読み取り中の%sから再試行して復旧する',
  async (code) => {
    const failure = new TypeError('terminated', { cause: Object.assign(new Error('socket closed'), { code }) });
    const broken = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1]));
          controller.error(failure);
        },
      }),
    );
    const fetch = vi.fn().mockResolvedValueOnce(broken).mockResolvedValueOnce(new Response('complete'));
    vi.stubGlobal('fetch', fetch);
    expect(Buffer.from(await createR2Storage().get('key')).toString()).toBe('complete');
    expect(fetch).toHaveBeenCalledTimes(2);
  },
);
