type Point = { lat: number; lng: number };
export type Bounds = [[number, number], [number, number]];

export function boundsFor(points: Point[], padding: number): Bounds {
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

export function centeredBoundsFor(center: Point, points: Point[], padding: number): Bounds {
  const halfLng = Math.max(0, ...points.map((point) => Math.abs(point.lng - center.lng))) * (1 + padding);
  const halfLat = Math.max(0, ...points.map((point) => Math.abs(point.lat - center.lat))) * (1 + padding);
  return [
    [center.lng - halfLng, center.lat - halfLat],
    [center.lng + halfLng, center.lat + halfLat],
  ];
}
