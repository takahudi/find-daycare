import { gzipSync } from 'node:zlib';
import { Compression, PMTiles, TileType, tileIdToZxy } from 'pmtiles';
import type { Source } from 'pmtiles';
import { expect, it } from 'vitest';
import { writePMTiles } from './pmtiles-writer.ts';

const options = {
  bounds: [135.36, 34.56, 135.62, 34.77] as const,
  minZoom: 0,
  maxZoom: 15,
  tileType: TileType.Mvt,
  tileCompression: Compression.Gzip,
};
const metadata = { vector_layers: [], version: 'test' };

it('重複を1回だけ格納し、全タイルとヘッダとメタデータを読み戻せる', async () => {
  const a = gzipSync('first');
  const b = gzipSync('second');
  const tiles = [
    { tileId: 4, bytes: a },
    { tileId: 0, bytes: a },
    { tileId: 1, bytes: b },
  ];
  const bytes = writePMTiles(tiles, options, metadata);
  const source: Source = {
    getKey: () => 'memory',
    getBytes: async (offset, length) => ({ data: Uint8Array.from(bytes.subarray(offset, offset + length)).buffer }),
  };
  const reader = new PMTiles(source);
  const header = await reader.getHeader();
  expect(header).toMatchObject({
    specVersion: 3,
    minLon: 135.36,
    minLat: 34.56,
    maxLon: 135.62,
    maxLat: 34.77,
    minZoom: 0,
    maxZoom: 15,
    centerZoom: 0,
    centerLon: 135.49,
    centerLat: 34.665,
    tileType: TileType.Mvt,
    tileCompression: Compression.Gzip,
    internalCompression: Compression.None,
    clustered: true,
    leafDirectoryLength: 0,
    numAddressedTiles: 3,
    numTileEntries: 3,
    numTileContents: 2,
    tileDataLength: a.length + b.length,
  });
  expect(await reader.getMetadata()).toEqual(metadata);
  const raw = new PMTiles(source, reader.cache, async (data) => data);
  for (const tile of tiles) {
    const zxy = tileIdToZxy(tile.tileId);
    expect(new Uint8Array((await raw.getZxy(...zxy))!.data)).toEqual(new Uint8Array(tile.bytes));
    expect(Buffer.from((await reader.getZxy(...zxy))!.data).toString()).toBe(tile.tileId === 1 ? 'second' : 'first');
  }
  expect(await reader.getZxy(1, 0, 1)).toBeUndefined();
  expect(bytes).toEqual(writePMTiles([...tiles].reverse(), options, metadata));
});

it('ルートが先頭16,384バイトに収まらない場合は書き出さない', () => {
  const bytes = gzipSync('same');
  const tiles = Array.from({ length: 5000 }, (_, tileId) => ({ tileId, bytes }));
  expect(() => writePMTiles(tiles, options, metadata)).toThrow('16,384');
});

it('タイルのないファイルや重複したtileIdを拒否する', () => {
  expect(() => writePMTiles([], options, metadata)).toThrow('1枚以上');
  const tile = { tileId: 0, bytes: gzipSync('same') };
  expect(() => writePMTiles([tile, tile], options, metadata)).toThrow('tileId');
});
