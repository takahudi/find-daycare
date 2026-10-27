import { gzipSync } from 'node:zlib';
import { Compression, TileType, zxyToTileId } from 'pmtiles';
import manifest from '../../data/map/tiles.json' with { type: 'json' };
import { writePMTiles } from './pmtiles-writer.ts';

export const fixtureTiles = [
  { z: 0, x: 0, y: 0, mvt: Uint8Array.from([26, 11, 10, 7, ...Buffer.from('fixture'), 120, 2]) },
  { z: 1, x: 0, y: 0, mvt: Uint8Array.from([26, 10, 10, 6, ...Buffer.from('second'), 120, 2]) },
].map((tile) => ({ ...tile, bytes: gzipSync(tile.mvt) }));

export function createTileFixture() {
  return writePMTiles(
    fixtureTiles.map(({ z, x, y, bytes }) => ({ tileId: zxyToTileId(z, x, y), bytes })),
    {
      bounds: [135.36, 34.56, 135.62, 34.77],
      minZoom: manifest.minZoom,
      maxZoom: manifest.maxZoom,
      tileType: TileType.Mvt,
      tileCompression: Compression.Gzip,
    },
    { vector_layers: [] },
  );
}
