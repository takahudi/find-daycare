import * as v from 'valibot';
import { DatasetSchema, GsiResponseSchema } from '../src/schema.ts';
import { WardDataSchemas } from './data-schema.ts';

/** 手で書くファイル。_ で始まるキーは出典や補正理由のメモで、読み込み時に除く */
export const ANNOTATED_FILES = ['manual-details.json', 'ward-details.json', 'websites.json'] as const;

const JsonSchemas = { ...WardDataSchemas, 'facilities.json': DatasetSchema, 'geocode-response': GsiResponseSchema };
export type GeocodeHit = v.InferOutput<typeof GsiResponseSchema>[number];

export function parseJson<K extends keyof typeof JsonSchemas>(text: string, document: K): v.InferOutput<(typeof JsonSchemas)[K]> {
  let data: unknown = JSON.parse(text);
  if (ANNOTATED_FILES.some((f) => f === document) && v.is(v.record(v.string(), v.unknown()), data)) {
    data = Object.fromEntries(Object.entries(data).filter(([key]) => !key.startsWith('_')));
  }
  const result = v.safeParse(JsonSchemas[document], data);
  if (!result.success) throw new Error(v.summarize(result.issues));
  return result.output;
}
