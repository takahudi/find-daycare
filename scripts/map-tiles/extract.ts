import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Compression, FetchSource, PMTiles, TileType, zxyToTileId } from 'pmtiles';
import type { Source } from 'pmtiles';
import * as v from 'valibot';
import { parseJson, writeJson } from '../json.ts';
import { StorageError, withRetry } from '../snapshot-storage.ts';
import { concurrently } from '../snapshot-transfer.ts';
import { sha256 } from '../snapshots.ts';
import { MAP_AREA } from './config.ts';
import { writePMTiles } from './pmtiles-writer.ts';
import type { Tile } from './pmtiles-writer.ts';
import { BuildSchema } from './schema.ts';
import type { TilesManifest } from './schema.ts';

export class RetryFetchSource extends FetchSource {
  override getBytes(offset: number, length: number, signal?: AbortSignal, etag?: string) {
    return withRetry(async () => {
      try {
        return await super.getBytes(
          offset,
          length,
          signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
          etag,
        );
      } catch (error) {
        const status = error instanceof Error && /^Bad response code: (5\d\d)$/.exec(error.message);
        if (status) throw new StorageError(Number(status[1]), error.message);
        throw error;
      }
    });
  }
}

export function tileCoordinates(z: number) {
  const [west, south, east, north] = MAP_AREA.bbox;
  const xAt = (lon: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
  const yAt = (lat: number) => {
    const radians = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * 2 ** z);
  };
  const coordinates = [];
  for (let x = xAt(west); x <= xAt(east); x++) {
    for (let y = yAt(north); y <= yAt(south); y++) coordinates.push({ z, x, y, tileId: zxyToTileId(z, x, y) });
  }
  return coordinates;
}

export async function extractTiles(source: Source) {
  const reader = new PMTiles(source);
  const header = await reader.getHeader();
  if (header.tileType !== TileType.Mvt || header.tileCompression !== Compression.Gzip || header.maxZoom < MAP_AREA.maxZoom)
    throw new Error('元ファイルにはMVT・gzip・maxZoom 15以上が必要です');
  const metadata = await reader.getMetadata();
  v.assert(
    v.looseObject({
      version: v.pipe(v.string('元メタデータにversionがありません'), v.nonEmpty()),
      vector_layers: v.array(v.unknown()),
    }),
    metadata,
  );
  // 再圧縮によって元のバイト列が変わらないよう、タイル本文だけは展開しない。
  const rawReader = new PMTiles(source, reader.cache, async (bytes) => bytes);
  const coordinates = Array.from({ length: MAP_AREA.maxZoom - MAP_AREA.minZoom + 1 }, (_, i) =>
    tileCoordinates(MAP_AREA.minZoom + i),
  ).flat();
  const tiles: Tile[] = [];
  await concurrently(
    coordinates,
    async ({ z, x, y, tileId }) => {
      const tile = await rawReader.getZxy(z, x, y);
      if (tile) tiles.push({ tileId, bytes: new Uint8Array(tile.data) });
    },
    8,
  );
  const bytes = writePMTiles(
    tiles,
    {
      bounds: MAP_AREA.bbox,
      minZoom: MAP_AREA.minZoom,
      maxZoom: MAP_AREA.maxZoom,
      tileType: header.tileType,
      tileCompression: header.tileCompression,
    },
    metadata,
  );
  return { bytes, tiles: tiles.length, tilesVersion: metadata.version };
}

export async function extractMapTiles(build?: string, { root = process.cwd(), log = console.log } = {}) {
  const manifestPath = path.join(root, 'data/map/tiles.json');
  if (build === undefined) {
    try {
      build = parseJson(await readFile(manifestPath, 'utf8'), 'tiles.json').source.build;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      throw new Error('data/map/tiles.jsonがありません。--build YYYYMMDDを指定してください', { cause: error });
    }
  }
  v.parse(BuildSchema, build);
  const url = `https://build.protomaps.com/${build}.pmtiles`;
  const { bytes, tiles, tilesVersion } = await extractTiles(new RetryFetchSource(url));
  const manifest: TilesManifest = {
    source: { build, url, tilesVersion },
    bbox: [...MAP_AREA.bbox],
    minZoom: MAP_AREA.minZoom,
    maxZoom: MAP_AREA.maxZoom,
    tiles,
    object: { key: `tiles/osaka-${build}.pmtiles`, sha256: sha256(bytes), size: bytes.length },
  };
  const output = path.join(root, `map-tiles/osaka-${build}.pmtiles`);
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(output, bytes);
  await writeJson('tiles.json', manifestPath, manifest);
  log(`map:extract: ${tiles} tiles, ${bytes.length} bytes, sha256 ${manifest.object.sha256}`);
  return manifest;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { build: { type: 'string' } } });
  await extractMapTiles(values.build);
}
