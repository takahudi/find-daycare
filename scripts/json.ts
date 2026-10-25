import type { Dataset } from '../src/types.ts';
import { ANNOTATED_FILES, type WardDataFiles } from './data-types.ts';

export interface GeocodeHit {
  properties: { title: string };
  geometry: { coordinates: [number, number] };
}

type JsonDocuments = WardDataFiles & {
  'facilities.json': Dataset;
  'geocode-response': GeocodeHit[];
};

// JSON の型の信頼境界。次の段階でスキーマ検証に置き換える。
export function parseJson<K extends keyof JsonDocuments>(text: string, document: K): JsonDocuments[K] {
  const data = JSON.parse(text);
  if (ANNOTATED_FILES.some((f) => f === document)) {
    for (const key of Object.keys(data)) if (key.startsWith('_')) delete data[key];
  }
  return data;
}
