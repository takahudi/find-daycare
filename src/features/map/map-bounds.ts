import type { LngLatBoundsLike } from 'maplibre-gl';

export function boundsFor(points: { lat: number; lng: number }[], padding: number): LngLatBoundsLike {
  const west = Math.min(...points.map((point) => point.lng));
  const east = Math.max(...points.map((point) => point.lng));
  const south = Math.min(...points.map((point) => point.lat));
  const north = Math.max(...points.map((point) => point.lat));
  const dx = (east - west) * padding;
  const dy = (north - south) * padding;
  return [
    [west - dx, south - dy],
    [east + dx, north + dy],
  ];
}
