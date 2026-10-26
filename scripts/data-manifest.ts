import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createManifest, selectIds } from './snapshots.ts';
import { writeJson } from './json.ts';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { date: { type: 'string' } } });
let count = 0;
let bytes = 0;
const ids = selectIds(positionals);
const manifests = await Promise.all(
  ids.map(async (id) => ({ id, manifest: await createManifest(path.resolve('sources', id), values.date) })),
);
for (const { id, manifest } of manifests) {
  await mkdir(path.resolve('data', id), { recursive: true });
  await writeJson('snapshot.json', path.resolve('data', id, 'snapshot.json'), manifest);
  const files = Object.values(manifest.files);
  const size = files.reduce((sum, file) => sum + file.size, 0);
  count += files.length;
  bytes += size;
  console.log(`${id}@${manifest.fetchedOn}: ${files.length} files, ${size} bytes`);
}
console.log(`manifest: ${ids.length} ids, ${count} files, ${bytes} bytes`);
