import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { VectorTile } from '@mapbox/vector-tile';
import { expression, type Feature, Formatted } from '@maplibre/maplibre-gl-style-spec';
import { layers, namedFlavor } from '@protomaps/basemaps';
import maplibrePackage from 'maplibre-gl/package.json' with { type: 'json' };
import basemapsPackage from '@protomaps/basemaps/package.json' with { type: 'json' };
import { PbfReader } from 'pbf';
import { PMTiles, type Source } from 'pmtiles';
import tiles from '../../data/map/tiles.json' with { type: 'json' };
import { tileCoordinates } from '../map-tiles/extract.ts';

// Unicode 範囲を複製すると MapLibre 更新でずれるため、使用中の版の判定を直接使う。
const unicodePath = new URL('../src/util/unicode_properties.g.ts', import.meta.resolve('maplibre-gl'));
const unicodeSource = stripTypeScriptTypes(await readFile(unicodePath, 'utf8'));
const { codePointUsesLocalIdeographFontFamily }: { codePointUsesLocalIdeographFontFamily: (id: number) => boolean } =
  await import('data:text/javascript;base64,' + Buffer.from(unicodeSource).toString('base64'));
const archivePath = process.argv[2] ?? `map-tiles/osaka-${tiles.source.build}.pmtiles`;
const bytes = await readFile(archivePath);
if (createHash('sha256').update(bytes).digest('hex') !== tiles.object.sha256)
  throw new Error('PMTiles の sha256 が記録と一致しません');
const source: Source = {
  getKey: () => archivePath,
  getBytes: async (offset, length) => ({
    data: bytes.buffer.slice(bytes.byteOffset + offset, bytes.byteOffset + offset + length),
  }),
};
const archive = new PMTiles(source);
const symbols = layers('basemap', namedFlavor('light'), { lang: 'ja' })
  .filter((layer) => layer.type === 'symbol')
  .filter((layer) => layer.layout?.['text-field']);
function compile(value: unknown, property: 'text-field' | 'text-font') {
  const result = expression.createExpression(value, 'layout.' + property);
  if (result.result === 'error') throw new Error(JSON.stringify(result.value));
  return result.value;
}
const compiled = symbols.map((layer) => ({
  source: layer['source-layer']!,
  text: compile(layer.layout!['text-field'], 'text-field'),
  font: compile(
    Array.isArray(layer.layout!['text-font']) && !expression.isExpression(layer.layout!['text-font'])
      ? ['literal', layer.layout!['text-font']]
      : layer.layout!['text-font'],
    'text-font',
  ),
  min: layer.minzoom ?? 0,
  max: layer.maxzoom ?? 24,
  transform: layer.layout!['text-transform'],
}));
const ranges = new Map<string, Set<number>>();
const seen = new Set<string>();
let scannedTiles = 0;
let labelFeatures = 0;
for (let z = tiles.minZoom; z <= tiles.maxZoom; z++) {
  for (const { x, y } of tileCoordinates(z)) {
    const tile = await archive.getZxy(z, x, y);
    if (!tile) continue;
    scannedTiles++;
    const vector = new VectorTile(new PbfReader(new Uint8Array(tile.data)));
    for (const [name, layer] of Object.entries(vector.layers)) {
      const relevant = compiled.filter((symbol) => symbol.source === name);
      if (!relevant.length) continue;
      for (let i = 0; i < layer.length; i++) {
        const original = layer.feature(i);
        const key = name + JSON.stringify(original.properties);
        if (seen.has(key)) continue;
        seen.add(key);
        labelFeatures++;
        const feature: Feature = { type: original.type, id: original.id, properties: original.properties };
        for (const symbol of relevant) {
          // フィルタと衝突判定で今は隠れるラベルも、別のズームで必要になるため含める。
          for (let zoom = Math.ceil(symbol.min); zoom < Math.min(symbol.max, 19); zoom++) {
            const globals = { zoom, isSupportedScript: () => true };
            const text: unknown = symbol.text.evaluateWithoutErrorHandling(globals, feature);
            if (text === null) continue;
            if (!(text instanceof Formatted) && typeof text !== 'string' && typeof text !== 'number')
              throw new Error('ラベルが文字列・数値・Formattedではありません');
            const font: unknown = symbol.font.evaluateWithoutErrorHandling(globals, feature);
            if (!Array.isArray(font) || !font.every((entry): entry is string => typeof entry === 'string'))
              throw new Error('fontstackが文字列の配列ではありません');
            const sections = text instanceof Formatted ? text.sections : [{ text: String(text), fontStack: null }];
            for (const section of sections) {
              const stack = section.fontStack ?? font.join(',');
              let label = section.text;
              if (symbol.transform === 'uppercase') label = label.toLocaleUpperCase('ja');
              if (symbol.transform === 'lowercase') label = label.toLocaleLowerCase('ja');
              const required = ranges.get(stack) ?? new Set<number>();
              ranges.set(stack, required);
              for (const character of label) {
                const id = character.codePointAt(0)!;
                if (!codePointUsesLocalIdeographFontFamily(id)) required.add(Math.floor(id / 256) * 256);
              }
            }
          }
        }
      }
    }
  }
}
const requiredRanges = Object.fromEntries(
  [...ranges]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([font, starts]) => [font, [...starts].sort((a, b) => a - b).map((start) => `${start}-${start + 255}`)]),
);
const report = {
  archive: { build: tiles.source.build, sha256: tiles.object.sha256, scannedTiles, labelFeatures },
  maplibreVersion: maplibrePackage.version,
  basemapsVersion: basemapsPackage.version,
  method:
    '全タイルのラベルを使用スタイルの text-field / text-font / format で評価。フィルタ・衝突判定は除外し、全ズーム0〜18を保守的に走査。localIdeographFontFamily の対象は使用中の MapLibre の判定で除外。',
  requiredRanges,
};
await writeFile(new URL('../../data/map/glyph-coverage.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
