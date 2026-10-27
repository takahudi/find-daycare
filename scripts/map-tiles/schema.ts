import * as v from 'valibot';
import { SnapshotFileSchema } from '../data-schema.ts';
import { MAP_AREA } from './config.ts';

export const BuildSchema = v.pipe(v.string(), v.regex(/^\d{8}$/, 'buildはYYYYMMDDの8桁で指定してください'));
export const TilesSchema = v.pipe(
  v.strictObject({
    source: v.strictObject({
      build: BuildSchema,
      url: v.string(),
      tilesVersion: v.pipe(v.string(), v.nonEmpty()),
    }),
    bbox: v.tuple([
      v.literal(MAP_AREA.bbox[0]),
      v.literal(MAP_AREA.bbox[1]),
      v.literal(MAP_AREA.bbox[2]),
      v.literal(MAP_AREA.bbox[3]),
    ]),
    minZoom: v.literal(MAP_AREA.minZoom),
    maxZoom: v.literal(MAP_AREA.maxZoom),
    tiles: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
    object: v.strictObject({ key: v.string(), ...SnapshotFileSchema.entries }),
  }),
  v.check(
    ({ source }) => source.url === `https://build.protomaps.com/${source.build}.pmtiles`,
    '元ファイルのURLがbuildと一致しません',
  ),
  v.check(({ source, object }) => object.key === `tiles/osaka-${source.build}.pmtiles`, '保管先のkeyがbuildと一致しません'),
);
export type TilesManifest = v.InferOutput<typeof TilesSchema>;
