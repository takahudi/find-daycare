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
  const previousView = useRef<{ home: Home | null; selected: Facility | undefined; popupOpen: boolean }>({
    home: null,
    selected: undefined,
    popupOpen: false,
  });
  const initialized = useRef(false);
  const pendingMove = useRef<(() => void) | null>(null);
  const fitPopup = useCallback(() => {
    if (!map || !popupRef.current) return;
    const container = map.getContainer().getBoundingClientRect();
    const bounds = popupRef.current.getElement().getBoundingClientRect();
    const dx = Math.min(0, bounds.left - container.left - 8) + Math.max(0, bounds.right - container.right + 8);
    const dy =
      bounds.height > container.height - 16
        ? bounds.top - container.top - 8
        : Math.min(0, bounds.top - container.top - 8) + Math.max(0, bounds.bottom - container.bottom + 8);
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) map.panBy([dx, dy], { duration: 0 });
  }, [map, popupRef]);
  const moveWhenVisible = useCallback(
    (move: () => void) => {
      if (!map) return;
      const { clientWidth, clientHeight } = map.getContainer();
      if (initialized.current && clientWidth && clientHeight) {
        map.resize();
        move();
      } else pendingMove.current = move;
    },
    [map],
  );

  useEffect(() => {
    if (!map) return undefined;
    initialized.current = false;
    // MapLibre の自動リサイズは非表示時に仮寸法へ戻すため、MapGL の trackResize を切り、実寸だけを監視する。
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
    if (!map) return undefined;
    const previous = previousView.current;
    const selectionChanged = previous.selected !== selected;
    const homeChanged = previous.home !== home;
    previousView.current = { home, selected, popupOpen };
    if (selectionChanged || homeChanged) pendingMove.current = null;

    let move: () => void;
    if (selectionChanged && selected) {
      move = () => {
        const height = popupRef.current?.getElement().offsetHeight ?? 0;
        const offsetY = height ? Math.max(0, height + 18 + 8 - map.getContainer().clientHeight / 2) : 0;
        map.flyTo({
          center: [selected.lng, selected.lat],
          zoom: Math.max(map.getZoom(), 16),
          duration: 600,
          offset: [0, offsetY],
        });
      };
    } else if (homeChanged && home) {
      const nearest = [...facilities].sort((a, b) => distanceMeters(home, a) - distanceMeters(home, b)).slice(0, 5);
      move = () => map.fitBounds(boundsFor([home, ...nearest], 0.2), { duration: 600, maxZoom: 16 });
    } else if (popupOpen && !previous.popupOpen) {
      move = fitPopup;
    } else return undefined;

    const run = () => moveWhenVisible(move);
    const popup = popupRef.current;
    // react-map-gl は passive effect で DOM を付けるため、兄弟の JSX 順では準備完了を保証できない。
    if (popupOpen && popup && !popup.isOpen()) {
      popup.once('open', run);
      return () => {
        popup.off('open', run);
      };
    }
    run();
    return undefined;
  }, [map, home, selected, popupOpen, facilities, popupRef, moveWhenVisible, fitPopup]);
  return null;
}
