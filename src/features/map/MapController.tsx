import { useCallback, useEffect, useRef } from 'react';
import { useMap } from 'react-map-gl/maplibre';
import type { LngLatBoundsLike } from 'maplibre-gl';
import type { Facility, Home } from '../../schema';
import { distanceMeters } from '../../lib/geo';
import { boundsFor } from './map-bounds';

export function MapController({
  facilities,
  home,
  selectedId,
  initialBounds,
}: {
  facilities: Facility[];
  home: Home | null;
  selectedId: string | null;
  initialBounds: LngLatBoundsLike;
}) {
  const { current: map } = useMap();
  const selected = facilities.find((facility) => facility.id === selectedId);
  // 自宅が変わったときだけ寄せるため、絞り込みの変更では移動しない。
  const facilitiesRef = useRef(facilities);
  useEffect(() => {
    facilitiesRef.current = facilities;
  }, [facilities]);
  const initialized = useRef(false);
  const pendingMove = useRef<(() => void) | null>(null);
  const moveWhenVisible = useCallback(
    (move: () => void) => {
      if (!map) return;
      const { clientWidth, clientHeight } = map.getContainer();
      if (initialized.current && clientWidth && clientHeight) move();
      else pendingMove.current = move;
    },
    [map],
  );

  useEffect(() => {
    if (!map) return undefined;
    initialized.current = false;
    const observer = new ResizeObserver(() => {
      const { clientWidth, clientHeight } = map.getContainer();
      if (!clientWidth || !clientHeight) return;
      map.resize();
      // 非表示で作られた地図の仮のサイズでは全施設の範囲が決まらない。
      if (!initialized.current) {
        initialized.current = true;
        map.fitBounds(initialBounds, { duration: 0 });
      }
      if (pendingMove.current) {
        const move = pendingMove.current;
        pendingMove.current = null;
        move();
      }
    });
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map, initialBounds]);

  useEffect(() => {
    if (!map || !home) return;
    const nearest = [...facilitiesRef.current].sort((a, b) => distanceMeters(home, a) - distanceMeters(home, b)).slice(0, 5);
    moveWhenVisible(() => map.fitBounds(boundsFor([home, ...nearest], 0.2), { duration: 600, maxZoom: 16 }));
  }, [map, home, moveWhenVisible]);

  useEffect(() => {
    if (!map || !selected) return;
    moveWhenVisible(() => map.flyTo({ center: [selected.lng, selected.lat], zoom: Math.max(map.getZoom(), 16), duration: 600 }));
  }, [map, selected, moveWhenVisible]);
  return null;
}
