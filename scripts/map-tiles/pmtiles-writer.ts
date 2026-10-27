import { Compression } from 'pmtiles';
import type { TileType } from 'pmtiles';
import { sha256 } from '../snapshots.ts';

export type Bounds = readonly [west: number, south: number, east: number, north: number];
export interface Tile {
  tileId: number;
  bytes: Uint8Array;
}
export interface TileHeader {
  bounds: Bounds;
  minZoom: number;
  maxZoom: number;
  tileType: TileType;
  tileCompression: Compression;
}

export function writePMTiles(tiles: readonly Tile[], options: TileHeader, metadata: Record<string, unknown>): Uint8Array {
  if (!tiles.length) throw new Error('PMTilesには1枚以上のタイルが必要です');
  const contents = new Map<string, { offset: number; length: number }>();
  const blobs: Uint8Array[] = [];
  let dataLength = 0;
  const entries = [...tiles]
    .sort((a, b) => a.tileId - b.tileId)
    .map(({ tileId, bytes }, i, sorted) => {
      if (!Number.isSafeInteger(tileId) || tileId < 0 || (i > 0 && tileId === sorted[i - 1].tileId))
        throw new Error('tileIdは重複のない非負の安全な整数が必要です');
      if (!bytes.length) throw new Error('空のタイルは書き出せません');
      const hash = sha256(bytes);
      let content = contents.get(hash);
      if (!content) {
        content = { offset: dataLength, length: bytes.length };
        contents.set(hash, content);
        blobs.push(bytes);
        dataLength += bytes.length;
      }
      return { tileId, ...content };
    });
  const directory: number[] = [];
  function varint(value: number) {
    while (value >= 128) {
      directory.push((value % 128) + 128);
      value = Math.floor(value / 128);
    }
    directory.push(value);
  }
  varint(entries.length);
  let lastId = 0;
  for (const entry of entries) {
    varint(entry.tileId - lastId);
    lastId = entry.tileId;
  }
  for (let i = 0; i < entries.length; i++) varint(1);
  for (const entry of entries) varint(entry.length);
  for (const [i, entry] of entries.entries()) {
    const previous = entries[i - 1];
    varint(previous && entry.offset === previous.offset + previous.length ? 0 : entry.offset + 1);
  }
  const headerSize = 127;
  if (headerSize + directory.length > 16_384) throw new Error('ヘッダとルートディレクトリが16,384バイトを超えています');
  const json = Buffer.from(JSON.stringify(metadata), 'utf8');
  const metadataOffset = headerSize + directory.length;
  const dataOffset = metadataOffset + json.length;
  const header = Buffer.alloc(headerSize);
  header.write('PMTiles', 0, 'utf8');
  header[7] = 3;
  for (const [offset, value] of [
    [8, headerSize],
    [16, directory.length],
    [24, metadataOffset],
    [32, json.length],
    [40, dataOffset],
    [48, 0],
    [56, dataOffset],
    [64, dataLength],
    [72, entries.length],
    [80, entries.length],
    [88, contents.size],
  ])
    header.writeBigUInt64LE(BigInt(value), offset);
  header[96] = 1;
  // gzipヘッダのOS差を避け、同じ入力から同じファイルを作れるようにする。
  header[97] = Compression.None;
  header[98] = options.tileCompression;
  header[99] = options.tileType;
  header[100] = options.minZoom;
  header[101] = options.maxZoom;
  options.bounds.forEach((value, i) => header.writeInt32LE(Math.round(value * 1e7), 102 + i * 4));
  const [west, south, east, north] = options.bounds;
  header[118] = options.minZoom;
  header.writeInt32LE(Math.round(((west + east) / 2) * 1e7), 119);
  header.writeInt32LE(Math.round(((south + north) / 2) * 1e7), 123);
  return Buffer.concat([header, Uint8Array.from(directory), json, ...blobs]);
}
