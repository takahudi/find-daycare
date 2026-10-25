import type { Dataset } from '../src/types.ts';
import type { WardDataFiles } from './data-types.ts';

export interface GeocodeHit {
  properties: { title: string };
  geometry: { coordinates: [number, number] };
}

type JsonDocuments = WardDataFiles & {
  'facilities.json': Dataset;
  'geocode-response': GeocodeHit[];
};

// JSON の型の信頼境界と手書き注記の除去をここに集め、次の段階でスキーマ検証へ置き換える。
export function parseJson<K extends keyof JsonDocuments>(text: string, document: K): JsonDocuments[K] {
  const data = JSON.parse(text);
  if (document === 'manual-details.json' || document === 'ward-details.json' || document === 'websites.json') {
    // 手書きの出典・補正メモを表す _ キーは、施設データとして扱わないためここで除く。
    for (const key of Object.keys(data)) if (key.startsWith('_')) delete data[key];
  }
  return data;
}
