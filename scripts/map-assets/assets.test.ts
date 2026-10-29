import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import manifest from '../../data/map/assets.json' with { type: 'json' };
import coverage from '../../data/map/glyph-coverage.json' with { type: 'json' };
import tiles from '../../data/map/tiles.json' with { type: 'json' };

const root = fileURLToPath(new URL('../../public/map/assets/', import.meta.url));
function filesIn(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path.replaceAll('\\', '/')];
  });
}

describe('固定コミットから配信する地図アセット', () => {
  it('記録と実際の全ファイルのsha256とバイト数が一致する', () => {
    expect(manifest.commit).toMatch(/^[a-f0-9]{40}$/);
    const actual = filesIn(root)
      .map((file) => file.slice(file.indexOf('/public/map/assets/') + '/public/map/assets/'.length))
      .sort();
    expect(actual).toEqual(manifest.files.map((file) => file.path).sort());
    for (const file of manifest.files) {
      const bytes = readFileSync(join(root, file.path));
      expect(bytes.byteLength, file.path).toBe(file.size);
      expect(createHash('sha256').update(bytes).digest('hex'), file.path).toBe(file.sha256);
    }
  });

  it('各fontstackの全範囲とlightの1x・2xを配信する', () => {
    const paths = new Set(manifest.files.map((file) => file.path));
    for (const font of manifest.fontstacks)
      for (const range of manifest.ranges) expect(paths.has(`fonts/${font}/${range}.pbf`)).toBe(true);
    for (const suffix of ['.png', '.json', '@2x.png', '@2x.json']) expect(paths.has(`sprites/v4/light${suffix}`)).toBe(true);
    expect(paths.has('fonts/OFL.txt')).toBe(true);
  });

  it('実PMTilesのラベルから記録したfontstackごとの必要範囲をすべて配信する', () => {
    expect(coverage.archive.sha256).toBe(tiles.object.sha256);
    expect(coverage.archive.scannedTiles).toBe(tiles.tiles);
    expect(manifest.requiredRanges).toEqual(coverage.requiredRanges);
    for (const [font, ranges] of Object.entries(coverage.requiredRanges)) {
      for (const range of ranges) {
        const path = `fonts/${font}/${range}.pbf`;
        expect(
          manifest.files.some((file) => file.path === path),
          path,
        ).toBe(true);
        expect(readFileSync(join(root, path)).byteLength, path).toBeGreaterThan(0);
      }
    }
  });
});
