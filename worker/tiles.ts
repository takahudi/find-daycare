import { Compression, PMTiles, ResolvedValueCache, TileType } from 'pmtiles';
import manifest from '../data/map/tiles.json' with { type: 'json' };

export interface TileBucket {
  get(
    key: string,
    options: { range: { offset: number; length: number } },
  ): Promise<{ size: number; arrayBuffer(): Promise<ArrayBuffer> } | null>;
}

const archives = new WeakMap<TileBucket, PMTiles>();

// タイルは gzip のまま返すので展開しない。形式は serveTile でヘッダを見て確かめる。
const passThrough = async (data: ArrayBuffer) => data;

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
      new ResolvedValueCache(100, true, passThrough),
      passThrough,
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
  const ifNoneMatch =
    request.headers
      .get('If-None-Match')
      ?.split(',')
      .map((value) => value.trim()) ?? [];
  // ETag は記録だけで決まるので、R2 を読まずに答えられる。* はタイルがあるときだけ一致する。
  if (ifNoneMatch.some((value) => value.replace(/^W\//, '') === etag)) return new Response(null, { status: 304, headers });

  try {
    const archive = archiveFor(bucket);
    const { internalCompression, tileCompression, tileType } = await archive.getHeader();
    if (internalCompression !== Compression.None || tileCompression !== Compression.Gzip || tileType !== TileType.Mvt)
      throw new Error('地図タイルのPMTilesは非圧縮のディレクトリとgzipのMVTが必要です');
    const tile = await archive.getZxy(z, x, y);
    if (!tile) return new Response(null, { status: 204, headers });
    if (ifNoneMatch.includes('*')) return new Response(null, { status: 304, headers });
    const init = {
      status: 200,
      headers: { ...headers, 'Content-Encoding': 'gzip' },
      encodeBody: 'manual',
    } as const;
    return new Response(request.method === 'HEAD' ? null : tile.data, init);
  } catch (error) {
    // 失敗したときのヘッダやディレクトリを使い回さず、次の要求で読み直す。
    archives.delete(bucket);
    console.error('地図タイルを配信できませんでした', error);
    return uncached(503);
  }
}
