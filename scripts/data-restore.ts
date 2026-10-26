import path from 'node:path';
import { parseArgs } from 'node:util';
import { createR2StorageIfConfigured } from './snapshot-storage.ts';
import { restoreSnapshots } from './snapshot-transfer.ts';
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { dest: { type: 'string' }, 'discard-unarchived': { type: 'string', multiple: true } },
});
await restoreSnapshots(createR2StorageIfConfigured(), positionals, {
  ...(values.dest ? { dest: path.resolve(values.dest) } : {}),
  discardUnarchived: values['discard-unarchived'],
});
