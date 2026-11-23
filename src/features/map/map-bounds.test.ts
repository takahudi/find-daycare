import { describe, expect, it } from 'vitest';
import { boundsFor, centeredBoundsFor } from './map-bounds';

describe('boundsFor', () => {
  it('pads the bounding box of points on all sides', () => {
    const [[west, south], [east, north]] = boundsFor(
      [
        { lat: 34.6, lng: 135.5 },
        { lat: 34.7, lng: 135.6 },
      ],
      0.1,
    );
    expect(west).toBeCloseTo(135.49);
    expect(east).toBeCloseTo(135.61);
    expect(south).toBeCloseTo(34.59);
    expect(north).toBeCloseTo(34.71);
  });
});

describe('centeredBoundsFor', () => {
  it('keeps the center point at the exact midpoint even when nearby points are lopsided', () => {
    const home = { lat: 34.675, lng: 135.535 };
    const lopsidedPoints = [
      { lat: 34.685, lng: 135.545 },
      { lat: 34.68, lng: 135.555 },
    ];
    const [[west, south], [east, north]] = centeredBoundsFor(home, lopsidedPoints, 0.2);

    expect((west + east) / 2).toBeCloseTo(home.lng);
    expect((south + north) / 2).toBeCloseTo(home.lat);
    for (const point of lopsidedPoints) {
      expect(point.lng).toBeGreaterThan(west);
      expect(point.lng).toBeLessThan(east);
      expect(point.lat).toBeGreaterThan(south);
      expect(point.lat).toBeLessThan(north);
    }
  });

  it('collapses cleanly to the center when there are no nearby points', () => {
    const home = { lat: 34.675, lng: 135.535 };
    expect(centeredBoundsFor(home, [], 0.2)).toEqual([
      [home.lng, home.lat],
      [home.lng, home.lat],
    ]);
  });
});
