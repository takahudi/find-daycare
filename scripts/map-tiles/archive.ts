import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { parseJson } from '../json.ts';
import { createR2Storage } from '../snapshot-storage.ts';
import type { SnapshotStorage } from '../snapshot-storage.ts';
import { sha256 } from '../snapshots.ts';
import { MAP_R2_ENVIRONMENT, MAP_R2_REQUEST_TIMEOUTS } from './config.ts';

export async function archiveMapTiles(storage: SnapshotStorage, { root = process.cwd(), log = console.log } = {}) {
  const manifest = parseJson(await readFile(path.join(root, 'data/map/tiles.json'), 'utf8'), 'tiles.json');
  const file = path.join(root, `map-tiles/osaka-${manifest.source.build}.pmtiles`);
  const bytes = await readFile(file);
  const { key, sha256: hash, size } = manifest.object;
  if (bytes.length !== size || sha256(bytes) !== hash)
    throw new Error(`${file}: ローカルファイルのsha256またはsizeが記録と一致しません`);
  const existing = await storage.head(key);
  if (existing) {
    if (existing.sha256 !== hash) throw new Error(`${key}: 既存オブジェクトのsha256が異なります。上書きしません`);
    log(`保管済み: ${key}`);
    return;
  }
  const result = await storage.put(key, bytes, hash);
  if ((await storage.head(key))?.sha256 !== hash) throw new Error(`${key}: PUT後のsha256が記録と一致しません`);
  log(`${result === 'exists' ? '保管済み' : '保管しました'}: ${key}`);
}

if (import.meta.main) {
  parseArgs();
  await archiveMapTiles(createR2Storage(MAP_R2_ENVIRONMENT, MAP_R2_REQUEST_TIMEOUTS));
}
