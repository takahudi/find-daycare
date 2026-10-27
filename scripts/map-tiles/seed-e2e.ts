import { mkdir, writeFile } from 'node:fs/promises';
import { putLocalTiles } from './local-r2.ts';
import { createTileFixture } from './tile-fixture.ts';

await mkdir('.audit', { recursive: true });
const file = '.audit/e2e-tiles.pmtiles';
await writeFile(file, createTileFixture());
putLocalTiles(file);
