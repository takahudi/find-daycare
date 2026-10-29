import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import coverage from '../../data/map/glyph-coverage.json' with { type: 'json' };

const commit = '028c18f713baecad011301ff7a69acc39bcc2ae7';
const fontstacks = Object.keys(coverage.requiredRanges);
const ranges = ['0-255', '256-511', '8192-8447'];
const paths = [
  ...Object.entries(coverage.requiredRanges).flatMap(([font, required]) =>
    [...new Set([...ranges, ...required])].map((range) => `fonts/${font}/${range}.pbf`),
  ),
  'fonts/OFL.txt',
  ...['.json', '.png', '@2x.json', '@2x.png'].map((suffix) => `sprites/v4/light${suffix}`),
];
const files = [];
const generated = [];
for (const path of paths) {
  let bytes: Uint8Array;
  if (path.endsWith('/917760-918015.pbf')) {
    // 上流は補助異体字セレクタを持たない。空の fontstack を返し、基底文字は通常どおり描く。
    bytes = Uint8Array.of(0x0a, 0x00);
    generated.push({ path, reason: '上流にない補助異体字セレクタの範囲。glyphを持たないfontstackを生成する。' });
  } else {
    const response = await fetch(`https://raw.githubusercontent.com/protomaps/basemaps-assets/${commit}/${path}`);
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    bytes = new Uint8Array(await response.arrayBuffer());
  }
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
      requiredRanges: coverage.requiredRanges,
      generated,
      glyphs: '/map/assets/fonts/{fontstack}/{range}.pbf',
      sprite: '/map/assets/sprites/v4/light',
      files,
    },
    null,
    2,
  ) + '\n',
);
console.log(`地図アセット ${files.length} ファイル、${files.reduce((sum, file) => sum + file.size, 0)} バイト`);
