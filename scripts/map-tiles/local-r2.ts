import { execFileSync } from 'node:child_process';
import path from 'node:path';
import manifest from '../../data/map/tiles.json' with { type: 'json' };

export function putLocalTiles(file: string) {
  execFileSync(
    process.execPath,
    [
      path.resolve('node_modules/wrangler/bin/wrangler.js'),
      'r2',
      'object',
      'put',
      `find-daycare-map/${manifest.object.key}`,
      '--file',
      file,
      '--config',
      'wrangler.jsonc',
      '--local',
      '--persist-to',
      '.wrangler/state',
    ],
    { stdio: 'inherit' },
  );
}
