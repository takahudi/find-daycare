import * as v from 'valibot';
import { CapacitySchema, CountSchema, HomeSchema, inOsakaCity, HttpUrlSchema, TextSchema } from '../src/schema.ts';

export const PdfDetailSchema = v.strictObject({
  kana: v.nullable(TextSchema),
  capacity: v.nullable(CapacitySchema),
  weekday: v.nullable(TextSchema),
  saturday: v.nullable(TextSchema),
  nightHours: v.optional(TextSchema),
  services: v.array(TextSchema),
  url: v.nullable(HttpUrlSchema),
  approvedOn: v.nullable(TextSchema),
  note: v.optional(TextSchema),
});
export const ManualDetailSchema = v.omit(PdfDetailSchema, ['kana']);
export const WardDetailSchema = v.strictObject({
  name: v.optional(TextSchema),
  kana: v.optional(TextSchema),
  weekday: v.optional(TextSchema),
  saturday: v.optional(TextSchema),
  capacity: v.optional(v.nullable(CapacitySchema)),
  services: v.optional(v.array(TextSchema)),
  note: v.optional(TextSchema),
});
export const WebsiteSchema = v.strictObject({ url: v.nullable(HttpUrlSchema), label: TextSchema });
export const KigyoDetailSchema = v.strictObject({
  wardTag: TextSchema,
  phone: v.nullable(TextSchema),
  hours: v.strictObject({ weekday: v.optional(TextSchema), saturday: v.optional(TextSchema), holiday: v.optional(TextSchema) }),
  capacity: v.nullable(CountSchema),
  monthlyUpTo: v.nullable(TextSchema),
  freeOfCharge: v.nullable(v.boolean()),
  name: TextSchema,
  type: TextSchema,
  postalCode: v.optional(TextSchema),
  address: TextSchema,
  startedOn: v.optional(TextSchema),
  operator: v.optional(TextSchema),
  page: v.pipe(
    v.number('PDFのページは数値が必要です'),
    v.integer('PDFのページは整数が必要です'),
    v.minValue(1, 'PDFのページは1以上が必要です'),
  ),
});
export const GeocodePositionSchema = v.pipe(
  v.strictObject(HomeSchema.entries),
  v.check((position) => inOsakaCity(position), '座標が大阪市内の範囲外です'),
);

export const WardDataSchemas = {
  'pdf-details.json': v.record(TextSchema, PdfDetailSchema),
  'manual-details.json': v.record(TextSchema, ManualDetailSchema),
  'ward-details.json': v.record(TextSchema, WardDetailSchema),
  'websites.json': v.record(TextSchema, WebsiteSchema),
  'kigyo-details.json': v.record(TextSchema, KigyoDetailSchema),
  'geocode-cache.json': v.record(TextSchema, GeocodePositionSchema),
};

export type PdfDetail = v.InferOutput<typeof PdfDetailSchema>;
export type Website = v.InferOutput<typeof WebsiteSchema>;
export type KigyoDetail = v.InferOutput<typeof KigyoDetailSchema>;

export type WardDataFiles = { [K in keyof typeof WardDataSchemas]: v.InferOutput<(typeof WardDataSchemas)[K]> };
