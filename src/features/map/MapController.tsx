import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useMap } from 'react-map-gl/maplibre';
import type { LngLatBoundsLike, Popup } from 'maplibre-gl';
import type { Facility, Home } from '../../schema';
import { centerOnHome, DETAIL_ZOOM } from './home-camera';
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
  mapShown,
  legendRef,
}: {
  facilities: Facility[];
  home: Home | null;
  selectedId: string | null;
  initialBounds: LngLatBoundsLike;
  popupRef: RefObject<Popup | null>;
  popupOpen: boolean;
  mapShown: boolean;
  legendRef: RefObject<HTMLDivElement | null>;
}) {
  const { current: map } = useMap();
  const selected = facilities.find((facility) => facility.id === selectedId);
  const previousView = useRef<{ home: Home | null; selected: Facility | undefined; popupOpen: boolean; mapShown: boolean }>({
    home: null,
    selected: undefined,
    popupOpen: false,
    mapShown,
  });
  const initialMove = useRef(true);
  const initialized = useRef(false);
  const pendingMove = useRef<MapMove | null>(null);
  const resizeToContainer = useCallback(() => {
    if (!map) return;
    const { clientWidth, clientHeight } = map.getContainer();
    if (!clientWidth || !clientHeight) return;
    const canvas = map.getCanvas();
    const pixelRatio = map.getPixelRatio();
    if (canvas.width === Math.round(clientWidth * pixelRatio) && canvas.height === Math.round(clientHeight * pixelRatio)) {
      return;
    }
    map.resize();
    map.redraw();
  }, [map]);
  const focusHome = useCallback(
    (targetHome: Home, targetFacilities: Facility[], duration: number) => {
      if (!map) return;
      centerOnHome(map, targetHome, targetFacilities, legendRef.current, duration);
    },
    [map, legendRef],
  );
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
        // WebGL の復元が非表示の間に起きると、MapLibre は仮の 400×300 に合わせる。表示と同時の移動は
        // ResizeObserver より先に走るので、移動の前に必ず実寸へ合わせる。
        resizeToContainer();
        move.run();
      } else pendingMove.current = move;
    },
    [map, resizeToContainer],
  );

  useEffect(() => {
    if (!map) return undefined;
    const { clientWidth, clientHeight } = map.getContainer();
    initialized.current = clientWidth > 0 && clientHeight > 0;
    // MapLibre の自動リサイズは非表示時に仮寸法へ戻すため、MapGL の trackResize を切り、実寸だけを監視する。
    const observer = new ResizeObserver(() => {
      const { clientWidth: width, clientHeight: height } = map.getContainer();
      if (!width || !height) return;
      resizeToContainer();
      // 非表示で作られた地図の仮のサイズでは全施設の範囲が決まらない。
      if (!initialized.current) {
        initialized.current = true;
        if (pendingMove.current?.kind !== 'selection' && pendingMove.current?.kind !== 'home') {
          map.fitBounds(initialBounds, { duration: 0 });
        }
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
    const isInitial = initialMove.current;
    initialMove.current = false;
    const previous = previousView.current;
    const selectionChanged = previous.selected !== selected;
    const homeChanged = previous.home !== home;
    const reopenedMap = !previous.mapShown && mapShown;
    previousView.current = { home, selected, popupOpen, mapShown };
    // 行き先が消えた保留中の移動だけを捨てる。
    const pendingKind = pendingMove.current?.kind;
    if (pendingKind === 'home' ? homeChanged && !home : selectionChanged && !selected) pendingMove.current = null;

    let move: MapMove;
    if (selectionChanged && selected) {
      const duration = isInitial ? 0 : 600;
      move = {
        kind: 'selection',
        run: () => {
          const height = popupRef.current?.getElement().offsetHeight ?? 0;
          const offsetY = height ? Math.max(0, height + POPUP_OFFSET + POPUP_MARGIN - map.getContainer().clientHeight / 2) : 0;
          map.flyTo({
            center: [selected.lng, selected.lat],
            zoom: Math.max(map.getZoom(), DETAIL_ZOOM),
            duration,
            offset: [0, offsetY],
          });
        },
      };
    } else if (homeChanged && home) {
      const duration = isInitial ? 0 : 600;
      const targetFacilities = facilities;
      move = {
        kind: 'home',
        run: () => focusHome(home, targetFacilities, duration),
      };
    } else if (reopenedMap && home && !popupOpen && !pendingMove.current) {
      const targetFacilities = facilities;
      move = {
        kind: 'home',
        run: () => focusHome(home, targetFacilities, 0),
      };
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
  }, [map, home, selected, popupOpen, mapShown, facilities, popupRef, focusHome, moveWhenVisible, fitPopup]);
  return null;
}
