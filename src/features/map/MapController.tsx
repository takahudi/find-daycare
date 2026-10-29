import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useMap } from 'react-map-gl/maplibre';
import type { LngLatBoundsLike, Popup } from 'maplibre-gl';
import type { Facility, Home } from '../../schema';
import { distanceMeters } from '../../lib/geo';
import { boundsFor } from './map-bounds';
import { POPUP_OFFSET } from './FacilityPopup';

const POPUP_MARGIN = 8;

type MapMove = { kind: 'selection' | 'home' | 'popup'; run: () => void };

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
  const pendingMove = useRef<MapMove | null>(null);
  const appliedSize = useRef({ width: 0, height: 0 });
  const resizeToContainer = useCallback(() => {
    if (!map) return;
    const { clientWidth: width, clientHeight: height } = map.getContainer();
    appliedSize.current = { width, height };
    map.resize();
    map.redraw();
  }, [map]);
  const fitPopup = useCallback(() => {
    if (!map || !popupRef.current) return;
    const container = map.getContainer().getBoundingClientRect();
    const bounds = popupRef.current.getElement().getBoundingClientRect();
    const dx =
      Math.min(0, bounds.left - container.left - POPUP_MARGIN) + Math.max(0, bounds.right - container.right + POPUP_MARGIN);
    const dy =
      bounds.height > container.height - POPUP_MARGIN * 2
        ? bounds.top - container.top - POPUP_MARGIN
        : Math.min(0, bounds.top - container.top - POPUP_MARGIN) + Math.max(0, bounds.bottom - container.bottom + POPUP_MARGIN);
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) map.panBy([dx, dy], { duration: 0 });
  }, [map, popupRef]);
  const moveWhenVisible = useCallback(
    (move: MapMove) => {
      if (!map) return;
      const { clientWidth, clientHeight } = map.getContainer();
      if (initialized.current && clientWidth && clientHeight) {
        pendingMove.current = null;
        // 移動のたびに描き直さないよう、前回合わせた寸法と違うときだけ合わせる。WebGL の復元で MapLibre が非表示中に
        // 仮寸法へ戻した場合も、表示されたときの ResizeObserver が無条件に合わせ直す。
        if (clientWidth !== appliedSize.current.width || clientHeight !== appliedSize.current.height) resizeToContainer();
        move.run();
      } else pendingMove.current = move;
    },
    [map, resizeToContainer],
  );

  useEffect(() => {
    if (!map) return undefined;
    initialized.current = false;
    // MapLibre の自動リサイズは非表示時に仮寸法へ戻すため、MapGL の trackResize を切り、実寸だけを監視する。
    const observer = new ResizeObserver(() => {
      const { clientWidth, clientHeight } = map.getContainer();
      if (!clientWidth || !clientHeight) return;
      resizeToContainer();
      // 非表示で作られた地図の仮のサイズでは全施設の範囲が決まらない。
      if (!initialized.current) {
        initialized.current = true;
        map.fitBounds(initialBounds, { duration: 0 });
      }
      if (pendingMove.current) {
        const move = pendingMove.current;
        pendingMove.current = null;
        move.run();
      }
    });
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map, initialBounds, resizeToContainer]);

  useEffect(() => {
    if (!map) return undefined;
    const previous = previousView.current;
    const selectionChanged = previous.selected !== selected;
    const homeChanged = previous.home !== home;
    previousView.current = { home, selected, popupOpen };
    // 行き先が消えた保留中の移動だけを捨てる。
    const pendingKind = pendingMove.current?.kind;
    if (pendingKind === 'home' ? homeChanged && !home : selectionChanged && !selected) pendingMove.current = null;

    let move: MapMove;
    if (selectionChanged && selected) {
      move = {
        kind: 'selection',
        run: () => {
          const height = popupRef.current?.getElement().offsetHeight ?? 0;
          const offsetY = height ? Math.max(0, height + POPUP_OFFSET + POPUP_MARGIN - map.getContainer().clientHeight / 2) : 0;
          map.flyTo({
            center: [selected.lng, selected.lat],
            zoom: Math.max(map.getZoom(), 16),
            duration: 600,
            offset: [0, offsetY],
          });
        },
      };
    } else if (homeChanged && home) {
      const nearest = [...facilities].sort((a, b) => distanceMeters(home, a) - distanceMeters(home, b)).slice(0, 5);
      move = { kind: 'home', run: () => map.fitBounds(boundsFor([home, ...nearest], 0.2), { duration: 600, maxZoom: 16 }) };
    } else if (popupOpen && !previous.popupOpen) {
      move = { kind: 'popup', run: fitPopup };
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
