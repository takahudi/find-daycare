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

// 次の段階でスキーマ検証へ置き換えられるよう、JSON の型の信頼境界をここに集める。
export function parseJson<K extends keyof JsonDocuments>(text: string, _document: K): JsonDocuments[K] {
  return JSON.parse(text);
}
