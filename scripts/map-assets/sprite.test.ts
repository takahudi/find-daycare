import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expression, featureFilter, type Feature } from '@maplibre/maplibre-gl-style-spec';
import { layers, namedFlavor } from '@protomaps/basemaps';

function strings(value: unknown): string[] {
  return typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(strings) : [];
}

const required = new Set<string>();
for (const layer of layers('basemap', namedFlavor('light'), { lang: 'ja' })) {
  if (layer.type !== 'symbol' || !layer.layout?.['icon-image']) continue;
  const icon = layer.layout['icon-image'];
  if (typeof icon === 'string') {
    required.add(icon);
    continue;
  }
  const compiled = expression.createExpression(icon, 'layout.icon-image');
  if (compiled.result === 'error') throw new Error(JSON.stringify(compiled.value));
  const filter = layer.id === 'pois' ? featureFilter(layer.filter, 'filter') : null;
  const values = new Set([...strings(layer.filter), ...strings(icon), 'yes', 'no']);
  for (const value of values) {
    for (let length = 1; length <= 5; length++) {
      const feature: Feature = {
        type: 1,
        properties: { kind: value, network: value, capital: value, min_zoom: 0, shield_text: '1'.repeat(length) },
      };
      for (const zoom of [0, 8, 18]) {
        const name: unknown = compiled.value.evaluateWithoutErrorHandling({ zoom }, feature);
        if (typeof name !== 'string') throw new Error('アイコン名が文字列ではありません');
        if (filter && !filter.filter({ zoom }, feature)) continue;
        if (name) required.add(name);
      }
    }
  }
}

describe('使用スタイルとlight spriteの互換性', () => {
  for (const suffix of ['', '@2x']) {
    // 上流の全v4履歴に townhall がないため、互換コミットが得られるまで欠落を明示する。
    it.fails(`${suffix || '1x'} はスタイルの全アイコンを提供する（上流の townhall が欠落）`, () => {
      const sprite: unknown = JSON.parse(
        readFileSync(new URL(`../../public/map/assets/sprites/v4/light${suffix}.json`, import.meta.url), 'utf8'),
      );
      if (!sprite || typeof sprite !== 'object') throw new Error('spriteがオブジェクトではありません');
      expect([...required].filter((name) => !(name in sprite)).sort()).toEqual([]);
    });
    it(`${suffix || '1x'} の不足は上流にない townhall だけである`, () => {
      const sprite: unknown = JSON.parse(
        readFileSync(new URL(`../../public/map/assets/sprites/v4/light${suffix}.json`, import.meta.url), 'utf8'),
      );
      if (!sprite || typeof sprite !== 'object') throw new Error('spriteがオブジェクトではありません');
      expect([...required].filter((name) => !(name in sprite)).sort()).toEqual(['townhall']);
    });
  }
});
