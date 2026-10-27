import { writeFile } from 'node:fs/promises';
import * as v from 'valibot';
import { DatasetSchema } from '../src/schema.ts';
import { WardDataSchemas } from './data-schema.ts';
import { TilesSchema } from './map-tiles/schema.ts';

/** 手で書くファイル。_ で始まるキーは出典や補正理由のメモで、読み込み時に除く */
const ANNOTATED_FILES = ['manual-details.json', 'ward-details.json', 'websites.json'] as const;

const JsonSchemas = { ...WardDataSchemas, 'facilities.json': DatasetSchema, 'tiles.json': TilesSchema };

export function parseJson<K extends keyof typeof JsonSchemas>(text: string, document: K): v.InferOutput<(typeof JsonSchemas)[K]> {
  let data: unknown = JSON.parse(text);
  if (ANNOTATED_FILES.some((f) => f === document) && v.is(v.record(v.string(), v.unknown()), data)) {
    data = Object.fromEntries(Object.entries(data).filter(([key]) => !key.startsWith('_')));
  }
  return validateJson(document, data);
}

export function validateJson<K extends keyof typeof JsonSchemas>(
  document: K,
  data: unknown,
): v.InferOutput<(typeof JsonSchemas)[K]> {
  const result = v.safeParse(JsonSchemas[document], data);
  if (!result.success) {
    const prefix = document === 'facilities.json' ? '公開データの検証に失敗しました\n' : '';
    throw new Error(prefix + v.summarize(result.issues));
  }
  return result.output;
}

export async function writeJson<K extends keyof typeof JsonSchemas>(
  document: K,
  path: string,
  data: v.InferInput<(typeof JsonSchemas)[K]>,
): Promise<void> {
  validateJson(document, data);
  await writeFile(path, JSON.stringify(data, null, 2) + '\n');
}
