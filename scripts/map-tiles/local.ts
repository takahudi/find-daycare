import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import manifest from '../../data/map/tiles.json' with { type: 'json' };
import { sha256 } from '../snapshots.ts';
import { putLocalTiles } from './local-r2.ts';

parseArgs();
const file = `map-tiles/osaka-${manifest.source.build}.pmtiles`;
const bytes = await readFile(file);
if (bytes.length !== manifest.object.size || sha256(bytes) !== manifest.object.sha256)
  throw new Error(`${file}: ローカルファイルのsha256またはsizeが記録と一致しません`);
putLocalTiles(file);
