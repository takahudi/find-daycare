import { parseArgs } from 'node:util';
import { loadVerifiedSnapshots } from './snapshots.ts';

const { positionals } = parseArgs({ allowPositionals: true });
try {
  const manifests = await loadVerifiedSnapshots(positionals);
  console.log(`verify: ${Object.keys(manifests).length} ids verified`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
