import type { MapRef } from 'react-map-gl/maplibre';

const MIN_VISIBLE_MAP_HEIGHT = 120;
const MIN_CONTROL_CLEARANCE = 24;

type Rect = Pick<DOMRect, 'top' | 'bottom' | 'height'>;

export function hiddenBottomOf(mapRect: Rect, viewportHeight: number): number {
  if (mapRect.height <= 0 || viewportHeight <= 0) return 0;
  const rawHidden = Math.max(0, mapRect.bottom - viewportHeight);
  if (rawHidden <= 0) return 0;
  const maxPadding = Math.max(0, Math.floor(mapRect.height - MIN_VISIBLE_MAP_HEIGHT));
  return Math.min(Math.round(rawHidden), maxPadding);
}

export function controlBottomOffsetOf(mapRect: Rect, viewportHeight: number): number {
  if (mapRect.height <= 0 || viewportHeight <= 0 || mapRect.top >= viewportHeight) return 0;
  const rawHidden = Math.max(0, Math.round(mapRect.bottom - viewportHeight));
  if (rawHidden <= 0) return 0;
  return Math.min(rawHidden, Math.max(0, Math.floor(mapRect.height - MIN_CONTROL_CLEARANCE)));
}

export function syncViewportPadding(map: MapRef, options?: { force?: boolean }): number {
  const container = map.getContainer();
  if (!container.clientWidth || !container.clientHeight) return 0;
  const mapRect = container.getBoundingClientRect();
  const bottom = hiddenBottomOf(mapRect, window.innerHeight);
  const host = container.parentElement;
  if (host) {
    const controlOffset = controlBottomOffsetOf(mapRect, window.innerHeight);
    host.style.setProperty('--map-hidden-bottom', `${controlOffset}px`);
  }
  if (!options?.force && map.isMoving()) return map.getPadding().bottom ?? 0;
  const current = map.getPadding();
  if ((current.bottom ?? 0) !== bottom || (current.top ?? 0) !== 0 || (current.left ?? 0) !== 0 || (current.right ?? 0) !== 0) {
    map.setPadding({ top: 0, right: 0, left: 0, bottom });
  }
  return bottom;
}
