import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const commit = '028c18f713baecad011301ff7a69acc39bcc2ae7';
const fontstacks = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic', 'Noto Sans Devanagari Regular v1'];
const ranges = ['0-255', '256-511', '8192-8447'];
const paths = [
  ...fontstacks.flatMap((font) => ranges.map((range) => `fonts/${font}/${range}.pbf`)),
  'fonts/OFL.txt',
  ...['.json', '.png', '@2x.json', '@2x.png'].map((suffix) => `sprites/v4/light${suffix}`),
];
const files = [];
for (const path of paths) {
  const response = await fetch(`https://raw.githubusercontent.com/protomaps/basemaps-assets/${commit}/${path}`);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const destination = `public/map/assets/${path}`;
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  files.push({ path, size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(
  'data/map/assets.json',
  JSON.stringify(
    {
      repository: 'https://github.com/protomaps/basemaps-assets',
      commit,
      fontstacks,
      ranges,
      glyphs: '/map/assets/fonts/{fontstack}/{range}.pbf',
      sprite: '/map/assets/sprites/v4/light',
      files,
    },
    null,
    2,
  ) + '\n',
);
console.log(`地図アセット ${files.length} ファイル、${files.reduce((sum, file) => sum + file.size, 0)} バイト`);
