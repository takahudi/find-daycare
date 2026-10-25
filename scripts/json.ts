import * as v from 'valibot';
import { DatasetSchema } from '../src/schema.ts';
import { GeocodeResponseSchema, WardDataSchemas } from './data-schema.ts';
import { ANNOTATED_FILES } from './data-types.ts';

const JsonSchemas = { ...WardDataSchemas, 'facilities.json': DatasetSchema, 'geocode-response': GeocodeResponseSchema };
export type GeocodeHit = v.InferOutput<typeof GeocodeResponseSchema>[number];

export function parseJson<K extends keyof typeof JsonSchemas>(text: string, document: K): v.InferOutput<(typeof JsonSchemas)[K]> {
  let data: unknown = JSON.parse(text);
  if (ANNOTATED_FILES.some((f) => f === document) && v.is(v.record(v.string(), v.unknown()), data)) {
    data = Object.fromEntries(Object.entries(data).filter(([key]) => !key.startsWith('_')));
  }
  return v.parse(JsonSchemas[document], data);
}
