import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Compression, PMTiles, TileType, zxyToTileId } from 'pmtiles';
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

export class ProtomapsSource implements Source {
  readonly url: string;
  private etag: string | undefined;

  constructor(url: string) {
    this.url = url;
  }

  getKey() {
    return this.url;
  }

  getBytes(offset: number, length: number, signal?: AbortSignal) {
    return withRetry(
      async () => {
        const headers = new Headers({ Range: `bytes=${offset}-${offset + length - 1}` });
        if (this.etag) headers.set('If-Match', this.etag);
        const timeout = AbortSignal.timeout(120_000);
        const response = await fetch(this.url, {
          headers,
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        if (response.status !== 206) {
          await response.body?.cancel();
          if (response.status === 404 && offset === 0 && this.etag === undefined)
            throw new Error('そのbuildはbuild.protomaps.comにもうありません。--build YYYYMMDDで新しいbuildを指定してください');
          if (response.status === 412) throw new Error('取得中に元ファイルのETagが変わりました。抽出を中止します');
          throw new StorageError(response.status, `Range ${this.url}: ${response.status}`);
        }
        const etag = response.headers.get('etag');
        // 版を固定できないと、取得中の差し替えで別の版のタイルが混ざっても気づけない。
        if (!etag || etag.startsWith('W/')) {
          await response.body?.cancel();
          throw new Error('元ファイルに強いETagがないため版を固定できません。抽出を中止します');
        }
        if (this.etag !== undefined && this.etag !== etag) {
          await response.body?.cancel();
          throw new Error('取得中に元ファイルのETagが変わりました。抽出を中止します');
        }
        this.etag = etag;
        const contentRange = response.headers.get('content-range') ?? '';
        const data = await response.arrayBuffer();
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange);
        const [start, end, total] = match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [NaN, NaN, NaN];
        const endOfFile = data.byteLength < length && end + 1 === total;
        if (start !== offset || end - start + 1 !== data.byteLength || (data.byteLength !== length && !endOfFile))
          throw new Error(`Range ${this.url}: 要求した範囲と異なる応答です（${contentRange || 'Content-Rangeなし'}）`);
        return { data, etag };
      },
      undefined,
      [429],
    );
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
  if (
    header.tileType !== TileType.Mvt ||
    header.tileCompression !== Compression.Gzip ||
    header.minZoom > MAP_AREA.minZoom ||
    header.maxZoom < MAP_AREA.maxZoom
  )
    throw new Error('元ファイルにはMVT・gzip・minZoom 0・maxZoom 15以上が必要です');
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
  const found = new Set(tiles.map(({ tileId }) => tileId));
  const missing = coordinates.filter(({ tileId }) => !found.has(tileId)).map(({ z, x, y }) => `${z}/${x}/${y}`);
  if (missing.length) throw new Error(`範囲内のタイルが${missing.length}枚欠けています: ${missing.slice(0, 5).join(', ')}`);
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
  const { bytes, tiles, tilesVersion } = await extractTiles(new ProtomapsSource(url));
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
