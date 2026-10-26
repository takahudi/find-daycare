import path from 'node:path';
import { parseArgs } from 'node:util';
import { createR2Storage } from './snapshot-storage.ts';
import { restoreSnapshots } from './snapshot-transfer.ts';
const { values, positionals } = parseArgs({ allowPositionals: true, options: { dest: { type: 'string' } } });
await restoreSnapshots(createR2Storage(), positionals, values.dest ? { dest: path.resolve(values.dest) } : {});
