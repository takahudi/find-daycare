import * as v from 'valibot';
import { DatasetSchema, type Dataset } from '../schema';

const DATASET_TIMEOUT_MS = 30_000;

export async function loadDataset(url: string | null): Promise<Dataset> {
  if (!url) throw new Error('施設データの読み込み先が見つかりません。');
  const signal = AbortSignal.timeout(DATASET_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (cause) {
    throw new Error(
      signal.aborted
        ? '施設データの取得に時間がかかりすぎました。'
        : '施設データを取得できませんでした。通信状態を確かめてください。',
      { cause },
    );
  }
  if (!response.ok) throw new Error(`施設データの取得に失敗しました（HTTP ${response.status}）。`);
  let data: unknown;
  try {
    data = await response.json();
  } catch (cause) {
    throw new Error(
      signal.aborted
        ? '施設データの取得に時間がかかりすぎました。'
        : cause instanceof SyntaxError
          ? '施設データの形式が正しくありません。'
          : '施設データを取得できませんでした。通信状態を確かめてください。',
      { cause },
    );
  }
  try {
    return v.parse(DatasetSchema, data);
  } catch (cause) {
    if (v.isValiError(cause)) console.error('施設データの検証に失敗しました。', cause.issues);
    throw new Error('施設データの形式が正しくありません。', { cause });
  }
}
