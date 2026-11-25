import type { MapRef } from 'react-map-gl/maplibre';
import type { Facility, Home } from '../../schema';
import { distanceMeters } from '../../lib/geo';
import { centeredBoundsFor } from './map-bounds';
import { syncViewportPadding } from './viewport-padding';

const HOME_PADDING_MARGIN = 8;
const NEAREST_FACILITY_COUNT = 5;
// MapLibre のズームは 512px のタイルが基準なので、以前の Leaflet（256px）の16と同じ縮尺は15になる。
export const DETAIL_ZOOM = 15;

function nearestFacilities(targetHome: Home, targetFacilities: Facility[]): Facility[] {
  const nearest: { facility: Facility; distance: number }[] = [];
  for (const facility of targetFacilities) {
    const distance = distanceMeters(targetHome, facility);
    if (nearest.length < NEAREST_FACILITY_COUNT || distance < nearest[nearest.length - 1].distance) {
      let insertAt = nearest.length;
      while (insertAt > 0 && distance < nearest[insertAt - 1].distance) insertAt -= 1;
      nearest.splice(insertAt, 0, { facility, distance });
      if (nearest.length > NEAREST_FACILITY_COUNT) nearest.pop();
    }
  }
  return nearest.map((entry) => entry.facility);
}

function homePadding(container: HTMLElement, legend: HTMLElement | null, mapPaddingBottom: number) {
  const mapRect = container.getBoundingClientRect();
  const visibleBottom = mapRect.bottom - mapPaddingBottom;
  const width = mapRect.width;
  const height = Math.max(0, mapRect.height - mapPaddingBottom);
  const legendRect = legend?.getBoundingClientRect();
  const legendInset = legendRect && legendRect.height > 0 ? Math.max(0, visibleBottom - legendRect.top) : 0;
  const top = Math.min(HOME_PADDING_MARGIN, Math.floor(height / 8));
  const side = Math.min(16, Math.floor(width / 8));
  const bottom = Math.min(legendInset + HOME_PADDING_MARGIN, Math.floor(height / 3));
  return { top, bottom, left: side, right: side };
}

export function centerOnHome(
  map: MapRef,
  targetHome: Home,
  targetFacilities: Facility[],
  legend: HTMLElement | null,
  duration: number,
) {
  const mapPaddingBottom = syncViewportPadding(map, { force: true });
  const nearest = nearestFacilities(targetHome, targetFacilities);
  const padding = homePadding(map.getContainer(), legend, mapPaddingBottom);
  if (nearest.length === 0) {
    map.flyTo({
      center: [targetHome.lng, targetHome.lat],
      zoom: DETAIL_ZOOM,
      duration,
      offset: [0, (padding.top - padding.bottom) / 2],
    });
  } else {
    map.fitBounds(centeredBoundsFor(targetHome, nearest, 0.2), { duration, maxZoom: DETAIL_ZOOM, padding });
  }
}
