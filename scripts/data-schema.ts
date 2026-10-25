import * as v from 'valibot';
import {
  CapacitySchema,
  CountSchema,
  HomeSchema,
  HttpUrlSchema,
  LatitudeSchema,
  LongitudeSchema,
  TextSchema,
} from '../src/schema.ts';

export const PdfDetailSchema = v.object({
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
export const WardDetailSchema = v.object({
  name: v.optional(TextSchema),
  kana: v.optional(TextSchema),
  weekday: v.optional(TextSchema),
  saturday: v.optional(TextSchema),
  capacity: v.optional(v.nullable(CapacitySchema)),
  services: v.optional(v.array(TextSchema)),
  note: v.optional(TextSchema),
});
export const WebsiteSchema = v.object({ url: v.nullable(HttpUrlSchema), label: TextSchema });
export const KigyoDetailSchema = v.object({
  wardTag: TextSchema,
  phone: v.nullable(TextSchema),
  hours: v.object({ weekday: v.optional(TextSchema), saturday: v.optional(TextSchema), holiday: v.optional(TextSchema) }),
  capacity: v.nullable(CountSchema),
  monthlyUpTo: v.nullable(TextSchema),
  freeOfCharge: v.nullable(v.boolean()),
  name: TextSchema,
  type: TextSchema,
  postalCode: v.optional(TextSchema),
  address: TextSchema,
  startedOn: v.optional(TextSchema),
  operator: v.optional(TextSchema),
  page: v.pipe(CountSchema, v.minValue(1, 'PDFのページは1以上が必要です')),
});
export const GeocodePositionSchema = HomeSchema;
export const GeocodeHitSchema = v.object({
  properties: v.object({ title: TextSchema }),
  geometry: v.object({ coordinates: v.tuple([LongitudeSchema, LatitudeSchema]) }),
});
export const GeocodeResponseSchema = v.array(GeocodeHitSchema);

export const WardDataSchemas = {
  'pdf-details.json': v.record(TextSchema, PdfDetailSchema),
  'manual-details.json': v.record(TextSchema, ManualDetailSchema),
  'ward-details.json': v.record(TextSchema, WardDetailSchema),
  'websites.json': v.record(TextSchema, WebsiteSchema),
  'kigyo-details.json': v.record(TextSchema, KigyoDetailSchema),
  'geocode-cache.json': v.record(TextSchema, GeocodePositionSchema),
};
