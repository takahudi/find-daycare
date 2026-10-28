import { describe, expect, it } from 'vitest';
import tiles from '../../../data/map/tiles.json';
import assets from '../../../data/map/assets.json';
import { createMapStyle } from './map-style';

describe('同一オリジンのベースマップ', () => {
  it('記録されたbuildとズーム範囲のMVTを使い、18まで拡大できる元タイルを定義する', () => {
    const style = createMapStyle('https://daycare.test');
    expect(style.sources.basemap).toMatchObject({
      type: 'vector',
      tiles: [`/map/tiles/${tiles.source.build}/{z}/{x}/{y}.mvt`],
      minzoom: tiles.minZoom,
      maxzoom: tiles.maxZoom,
    });
    expect(tiles.source.tilesVersion).toMatch(/^4\./);
    expect(style.glyphs).toBe(assets.glyphs);
    expect(style.sprite).toBe(new URL(assets.sprite, 'https://daycare.test').href);
    expect(
      [
        style.glyphs,
        style.sprite,
        ...Object.values(style.sources).flatMap((source) => ('tiles' in source ? source.tiles : [])),
      ].every((url) => typeof url === 'string' && new URL(url, 'https://daycare.test').origin === 'https://daycare.test'),
    ).toBe(true);
  });

  it('スタイルが指定するfontstackをすべて配信し、日本語のラベルを選ぶ', () => {
    const fonts = new Set<string>();
    const collect = (value: unknown): void => {
      if (typeof value === 'string' && value.startsWith('Noto Sans')) fonts.add(value);
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    };
    const style = createMapStyle('https://daycare.test');
    collect(style.layers);
    expect([...fonts].sort()).toEqual([...assets.fontstacks].sort());
    expect(JSON.stringify(style.layers)).toContain('name:ja');
    expect(style.sources.basemap).toHaveProperty(
      'attribution',
      expect.stringContaining('https://www.openstreetmap.org/copyright'),
    );
  });
});
