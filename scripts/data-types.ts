import type * as v from 'valibot';
import type {
  PdfDetailSchema,
  ManualDetailSchema,
  WardDetailSchema,
  WebsiteSchema,
  KigyoDetailSchema,
  GeocodePositionSchema,
  WardDataSchemas,
} from './data-schema.ts';

export type PdfDetail = v.InferOutput<typeof PdfDetailSchema>;
export type ManualDetail = v.InferOutput<typeof ManualDetailSchema>;
export type WardDetail = v.InferOutput<typeof WardDetailSchema>;
export type Website = v.InferOutput<typeof WebsiteSchema>;
export type KigyoDetail = v.InferOutput<typeof KigyoDetailSchema>;
export type GeocodePosition = v.InferOutput<typeof GeocodePositionSchema>;

/** 手で書くファイル。_ で始まるキーは出典や補正理由のメモで、読み込み時に除く */
export const ANNOTATED_FILES = ['manual-details.json', 'ward-details.json', 'websites.json'] as const;
export type WardDataFiles = { [K in keyof typeof WardDataSchemas]: v.InferOutput<(typeof WardDataSchemas)[K]> };
