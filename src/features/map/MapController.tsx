import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useMap } from 'react-map-gl/maplibre';
import type { LngLatBoundsLike, Popup } from 'maplibre-gl';
import type { Facility, Home } from '../../schema';
import { distanceMeters } from '../../lib/geo';
import { boundsFor } from './map-bounds';

export function MapController({
  facilities,
  home,
  selectedId,
  initialBounds,
  popupRef,
  popupOpen,
}: {
  facilities: Facility[];
  home: Home | null;
  selectedId: string | null;
  initialBounds: LngLatBoundsLike;
  popupRef: RefObject<Popup | null>;
  popupOpen: boolean;
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
  const selectionMove = useRef<{ move: () => void; finish: () => void } | null>(null);
  const fitPopup = useCallback(() => {
    if (!map || !popupRef.current) return;
    const container = map.getContainer().getBoundingClientRect();
    const bounds = popupRef.current.getElement().getBoundingClientRect();
    const dx = Math.min(0, bounds.left - container.left - 8) + Math.max(0, bounds.right - container.right + 8);
    const dy = Math.min(0, bounds.top - container.top - 8) + Math.max(0, bounds.bottom - container.bottom + 8);
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) map.panBy([dx, dy], { duration: 0 });
  }, [map, popupRef]);
  const cancelSelectionMove = useCallback(() => {
    if (!selectionMove.current) return;
    map?.off('moveend', selectionMove.current.finish);
    if (pendingMove.current === selectionMove.current.move) pendingMove.current = null;
    selectionMove.current = null;
  }, [map]);
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
    cancelSelectionMove();
    const nearest = [...facilitiesRef.current].sort((a, b) => distanceMeters(home, a) - distanceMeters(home, b)).slice(0, 5);
    moveWhenVisible(() => map.fitBounds(boundsFor([home, ...nearest], 0.2), { duration: 600, maxZoom: 16 }));
  }, [map, home, moveWhenVisible, cancelSelectionMove]);

  useEffect(() => {
    if (!map || !selected) return undefined;
    const finish = () => {
      selectionMove.current = null;
      fitPopup();
    };
    const move = () => {
      // 最初の範囲合わせの moveend では補正せず、施設への移動が終わるまで待つ。
      map.stop();
      map.once('moveend', finish);
      map.flyTo({ center: [selected.lng, selected.lat], zoom: Math.max(map.getZoom(), 16), duration: 600 });
    };
    selectionMove.current = { move, finish };
    moveWhenVisible(move);
    return cancelSelectionMove;
  }, [map, selected, moveWhenVisible, fitPopup, cancelSelectionMove]);

  useEffect(() => {
    // 同じ施設の再表示だけを補正する。利用者のドラッグや自宅への移動には追従しない。
    if (popupOpen && initialized.current && !selectionMove.current) fitPopup();
  }, [popupOpen, fitPopup]);
  return null;
}
