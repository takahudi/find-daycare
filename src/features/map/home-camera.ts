import type { MapRef } from 'react-map-gl/maplibre';
import type { Facility, Home } from '../../schema';
import { distanceMeters } from '../../lib/geo';
import { centeredBoundsFor } from './map-bounds';

const HOME_PADDING_MARGIN = 8;
// MapLibre のズームは 512px のタイルが基準なので、以前の Leaflet（256px）の16と同じ縮尺は15になる。
export const DETAIL_ZOOM = 15;

function homePadding(container: HTMLElement, legend: HTMLElement | null) {
  const mapRect = container.getBoundingClientRect();
  const { width, height } = mapRect;
  const legendRect = legend?.getBoundingClientRect();
  const legendInset = legendRect && legendRect.height > 0 ? Math.max(0, mapRect.bottom - legendRect.top) : 0;
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
  const nearest = [...targetFacilities].sort((a, b) => distanceMeters(targetHome, a) - distanceMeters(targetHome, b)).slice(0, 5);
  const padding = homePadding(map.getContainer(), legend);
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
