import { Compression, PMTiles, ResolvedValueCache } from 'pmtiles';
import manifest from '../data/map/tiles.json' with { type: 'json' };

export interface TileBucket {
  get(
    key: string,
    options: { range: { offset: number; length: number } },
  ): Promise<{ size: number; arrayBuffer(): Promise<ArrayBuffer> } | null>;
}

const archives = new WeakMap<TileBucket, PMTiles>();

async function uncompressedDirectory(data: ArrayBuffer, compression: Compression) {
  if (compression !== Compression.None) throw new Error('地図タイルのディレクトリは非圧縮が必要です');
  return data;
}

async function gzipTile(data: ArrayBuffer, compression: Compression) {
  if (compression !== Compression.Gzip) throw new Error('地図タイルはgzip圧縮が必要です');
  return data;
}

function archiveFor(bucket: TileBucket): PMTiles {
  let archive = archives.get(bucket);
  if (!archive) {
    archive = new PMTiles(
      {
        getKey: () => manifest.object.key,
        async getBytes(offset, length) {
          const object = await bucket.get(manifest.object.key, { range: { offset, length } });
          if (!object) throw new Error('地図タイルのPMTilesがR2にありません');
          const data = await object.arrayBuffer();
          if (data.byteLength !== Math.min(length, object.size - offset))
            throw new Error('地図タイルのR2 Rangeの長さが一致しません');
          return { data };
        },
      },
      new ResolvedValueCache(100, true, uncompressedDirectory),
      gzipTile,
    );
    archives.set(bucket, archive);
  }
  return archive;
}

function uncached(status: number, headers?: Record<string, string>) {
  return new Response(null, { status, headers: { ...headers, 'Cache-Control': 'no-store' } });
}

export async function serveTile(request: Request, bucket: TileBucket): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return uncached(405, { Allow: 'GET, HEAD' });
  const match = /^\/map\/tiles\/([^/]+)\/(0|[1-9]\d*)\/(0|[1-9]\d*)\/(0|[1-9]\d*)\.mvt$/.exec(new URL(request.url).pathname);
  if (!match || match[1] !== manifest.source.build) return uncached(404);
  const [z, x, y] = match.slice(2).map(Number);
  if (![z, x, y].every(Number.isSafeInteger) || z < manifest.minZoom || z > manifest.maxZoom || x >= 2 ** z || y >= 2 ** z)
    return uncached(404);

  const etag = `"${manifest.object.sha256}-${z}-${x}-${y}"`;
  const headers = {
    'Content-Type': 'application/vnd.mapbox-vector-tile',
    'Cache-Control': 'public, max-age=31536000, immutable',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
  if (
    request.headers
      .get('If-None-Match')
      ?.split(',')
      .some((value) => value.trim() === '*' || value.trim().replace(/^W\//, '') === etag)
  )
    return new Response(null, { status: 304, headers });

  try {
    const tile = await archiveFor(bucket).getZxy(z, x, y);
    if (!tile) return new Response(null, { status: 204, headers });
    const init = {
      status: 200,
      headers: { ...headers, 'Content-Encoding': 'gzip' },
      encodeBody: 'manual',
    } as const;
    return new Response(request.method === 'HEAD' ? null : tile.data, init);
  } catch (error) {
    console.error('地図タイルをR2から読み取れませんでした', error);
    return uncached(503);
  }
}
