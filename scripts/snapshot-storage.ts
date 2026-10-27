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

function isNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (
    'code' in error &&
    /^(UND_ERR_(SOCKET|CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT)|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|EPIPE)$/.test(
      String(error.code),
    )
  )
    return true;
  if (error instanceof DOMException && error.name === 'TimeoutError') return true;
  if (
    error instanceof TypeError &&
    /^(fetch failed|Failed to fetch|NetworkError when attempting to fetch resource\.)$/.test(error.message)
  )
    return true;
  return error.cause !== error && isNetworkFailure(error.cause);
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  retryStatuses: readonly number[] = [],
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const retryable =
        isNetworkFailure(error) ||
        (error instanceof StorageError && ((error.status >= 500 && error.status <= 599) || retryStatuses.includes(error.status)));
      if (!retryable || attempt >= 3) throw error;
      await wait(250 * 2 ** attempt);
    }
  }
}

export interface R2Environment {
  variables: {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
  };
  readmeSection: string;
}

interface R2RequestTimeouts {
  HEAD?: number;
  GET?: number;
  PUT?: number;
}

const snapshotEnvironment: R2Environment = {
  variables: {
    accountId: 'R2_ACCOUNT_ID',
    accessKeyId: 'R2_ACCESS_KEY_ID',
    secretAccessKey: 'R2_SECRET_ACCESS_KEY',
    bucket: 'R2_BUCKET',
  },
  readmeSection: '一次情報を保管・復元する',
};

function loadEnvironment() {
  if (existsSync('.env')) process.loadEnvFile('.env');
}

export function createR2StorageIfConfigured() {
  loadEnvironment();
  return Object.values(snapshotEnvironment.variables).every((name) => process.env[name]?.trim()) ? createR2Storage() : undefined;
}

export function createR2Storage(
  environment: R2Environment = snapshotEnvironment,
  requestTimeouts: R2RequestTimeouts = {},
): SnapshotStorage {
  loadEnvironment();
  const { variables, readmeSection } = environment;
  const missing = Object.values(variables).filter((name) => !process.env[name]?.trim());
  if (missing.length)
    throw new Error(`R2環境変数がありません: ${missing.join(', ')}。READMEの「${readmeSection}」を確認してください`);
  const account = process.env[variables.accountId] ?? '';
  const bucket = process.env[variables.bucket] ?? '';
  if (!/^[a-f0-9]{32}$/.test(account) || !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucket))
    throw new Error(
      `${variables.accountId} または ${variables.bucket} が不正です。READMEの「${readmeSection}」を確認してください`,
    );
  const client = new AwsClient({
    accessKeyId: process.env[variables.accessKeyId] ?? '',
    secretAccessKey: process.env[variables.secretAccessKey] ?? '',
    region: 'auto',
    service: 's3',
    retries: 0,
  });
  const url = (key: string) =>
    `https://${account}.r2.cloudflarestorage.com/${bucket}/${key
      .split('/')
      .map((segment) =>
        encodeURIComponent(segment).replace(/[!'()*]/g, (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase()),
      )
      .join('/')}`;
  async function request(key: string, method: keyof R2RequestTimeouts, bytes?: Uint8Array, hash?: string) {
    return client.fetch(url(key), {
      method,
      ...(bytes ? { body: Buffer.from(bytes) } : {}),
      ...(hash ? { headers: { 'x-amz-meta-sha256': hash, 'x-amz-content-sha256': hash, 'If-None-Match': '*' } } : {}),
      signal: AbortSignal.timeout(requestTimeouts[method] ?? 120_000),
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
