import { parseArgs } from 'node:util';
import { createR2Storage } from './snapshot-storage.ts';
import { archiveSnapshots } from './snapshot-transfer.ts';
import { selectIds } from './snapshots.ts';
const { positionals } = parseArgs({ allowPositionals: true });
const ids = selectIds(positionals);
await archiveSnapshots(createR2Storage(), ids);
