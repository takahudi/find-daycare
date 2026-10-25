import { existsSync } from 'node:fs';
import { AwsClient } from 'aws4fetch';

export interface SnapshotStorage {
  head(key: string): Promise<{ sha256: string | null } | null>;
  put(key: string, bytes: Uint8Array, hash: string): Promise<'created' | 'exists'>;
  get(key: string): Promise<Uint8Array>;
}

export class StorageError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const retryable =
        error instanceof TypeError ||
        (error instanceof DOMException && error.name === 'TimeoutError') ||
        (error instanceof StorageError && error.status >= 500 && error.status <= 599);
      if (!retryable || attempt >= 3) throw error;
      await wait(250 * 2 ** attempt);
    }
  }
}

export function createR2Storage(): SnapshotStorage {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const names = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const;
  const missing = names.filter((name) => !process.env[name]?.trim());
  if (missing.length)
    throw new Error(`R2環境変数がありません: ${missing.join(', ')}。READMEの「一次情報を保管・復元する」を確認してください`);
  const account = process.env.R2_ACCOUNT_ID ?? '';
  const bucket = process.env.R2_BUCKET ?? '';
  if (!/^[a-f0-9]{32}$/.test(account) || !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucket))
    throw new Error('R2_ACCOUNT_ID または R2_BUCKET が不正です。READMEを確認してください');
  const client = new AwsClient({
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    region: 'auto',
    service: 's3',
    retries: 0,
  });
  const url = (key: string) =>
    `https://${account}.r2.cloudflarestorage.com/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
  async function request(key: string, method: string, bytes?: Uint8Array, hash?: string) {
    return client.fetch(url(key), {
      method,
      ...(bytes ? { body: Buffer.from(bytes) } : {}),
      ...(hash ? { headers: { 'x-amz-meta-sha256': hash, 'If-None-Match': '*' } } : {}),
      signal: AbortSignal.timeout(120_000),
    });
  }
  return {
    head: (key) =>
      withRetry(async () => {
        const response = await request(key, 'HEAD');
        if (response.status === 404) return null;
        if (!response.ok) throw new StorageError(response.status, `HEAD ${key}: ${response.status}`);
        return { sha256: response.headers.get('x-amz-meta-sha256') };
      }),
    put: (key, bytes, hash) =>
      withRetry(async () => {
        const response = await request(key, 'PUT', bytes, hash);
        await response.body?.cancel();
        if (response.status === 412) return 'exists';
        if (!response.ok) throw new StorageError(response.status, `PUT ${key}: ${response.status}`);
        return 'created';
      }),
    get: (key) =>
      withRetry(async () => {
        const response = await request(key, 'GET');
        if (!response.ok) {
          await response.body?.cancel();
          throw new StorageError(response.status, `GET ${key}: ${response.status}`);
        }
        return new Uint8Array(await response.arrayBuffer());
      }),
  };
}
