import { useEffect, useEffectEvent, useMemo, useRef } from 'react';
import { useMap } from 'react-map-gl/maplibre';
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent, MapSourceDataEvent } from 'maplibre-gl';
import type { GeoJSON } from 'geojson';
import type { Theme } from '../../app/theme';
import type { Facility, Home } from '../../schema';
import { parsePinImageId } from './pin-face';
import { pinImage, readPinTheme } from './pin-paint';
import {
  PIN_LAYERS,
  facilityPins,
  homePin,
  pickPin,
  pinCollection,
  routeCollection,
  ROUTE_SOURCE,
  selectedPin,
  type PinGeoBounds,
  type PinScene,
  type ScreenPoint,
} from './pin-layers';
import { installPinProbe } from './pin-probe';

// 最大ピン（選択中 30px × 1.2 = 36px → 半径 18px）に余裕を持たせた画面外除外マージン。
const PICK_BOUNDS_MARGIN_PX = 24;

export function PinOverlay({
  hintId,
  theme,
  facilities,
  allFacilities,
  vacancyOf,
  selectedId,
  home,
  onSelect,
  onDeselect,
}: {
  hintId: string;
  theme: Theme;
  facilities: Facility[];
  allFacilities: Facility[];
  vacancyOf: (facility: Facility) => number;
  selectedId: string | null;
  home: Home | null;
  onSelect: (id: string) => void;
  onDeselect: () => void;
}) {
  const map = useMap().current?.getMap();
  // Compiler は effect event が読む scene の計算をキャッシュしないため、source の同一性をここで保つ。
  const visibleIds = new Set(facilities.map((facility) => facility.id));
  const facilityKey = allFacilities.map((facility) => (visibleIds.has(facility.id) ? vacancyOf(facility) : '')).join(',');
  const base = useMemo(() => {
    const vacancies = new Map<string, number>();
    facilityKey.split(',').forEach((count, index) => {
      if (count !== '') vacancies.set(allFacilities[index].id, Number(count));
    });
    const pins = facilityPins(
      allFacilities,
      allFacilities.filter((facility) => vacancies.has(facility.id)),
      (facility) => vacancies.get(facility.id)!,
    );
    return { pins, data: pinCollection(pins) };
  }, [allFacilities, facilityKey]);
  const selected = useMemo(() => {
    const pin = selectedPin(base.pins, selectedId);
    return { pin, data: pinCollection(pin ? [pin] : []) };
  }, [base.pins, selectedId]);
  const homeAt = useMemo(() => {
    const pin = homePin(home);
    return { pin, data: pinCollection(pin ? [pin] : []) };
  }, [home]);
  const route = useMemo(() => routeCollection(homeAt.pin, selected.pin), [homeAt.pin, selected.pin]);
  const scene = useMemo<PinScene>(
    () => ({ facilities: base.pins, selected: selected.pin, home: homeAt.pin }),
    [base.pins, selected.pin, homeAt.pin],
  );
  const projectionCache = useRef<{
    key: string;
    points: WeakMap<readonly [number, number], ScreenPoint>;
    bounds: PinGeoBounds | null;
    width: number;
    height: number;
  }>({ key: '', points: new WeakMap(), bounds: null, width: 0, height: 0 });
  const pick = useEffectEvent((point: ScreenPoint) => {
    if (!map) return null;
    const nw = map.project([135.36, 34.77]);
    const se = map.project([135.62, 34.56]);
    const { clientWidth: width, clientHeight: height } = map.getContainer();
    const key = `${nw.x},${nw.y},${se.x},${se.y},${width},${height}`;
    if (projectionCache.current.key !== key) {
      let bounds: PinGeoBounds | null = null;
      if (width > 0 && height > 0) {
        const topLeft = map.unproject([-PICK_BOUNDS_MARGIN_PX, -PICK_BOUNDS_MARGIN_PX]);
        const bottomRight = map.unproject([width + PICK_BOUNDS_MARGIN_PX, height + PICK_BOUNDS_MARGIN_PX]);
        bounds = {
          west: Math.min(topLeft.lng, bottomRight.lng),
          east: Math.max(topLeft.lng, bottomRight.lng),
          south: Math.min(topLeft.lat, bottomRight.lat),
          north: Math.max(topLeft.lat, bottomRight.lat),
        };
      }
      projectionCache.current = { key, points: new WeakMap(), bounds, width, height };
    }
    const { points, bounds } = projectionCache.current;
    const visibleBounds = bounds && point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height ? bounds : undefined;
    return pickPin(
      scene,
      point,
      (lngLat) => {
        let projected = points.get(lngLat);
        if (!projected) {
          projected = map.project(lngLat);
          points.set(lngLat, projected);
        }
        return projected;
      },
      visibleBounds,
    );
  });
  const hoverPoint = useRef<ScreenPoint | null>(null);
  const refreshCursor = useEffectEvent(() => {
    if (!map) return;
    const hit = hoverPoint.current ? pick(hoverPoint.current) : null;
    map.getCanvas().style.cursor = hit && (hit.kind === 'facility' || scene.selected !== null) ? 'pointer' : '';
  });
  useSourceData(map, 'facility-pins', base.data);
  useSourceData(map, 'facility-pin-selected', selected.data);
  useSourceData(map, 'home-pin', homeAt.data);
  useSourceData(map, ROUTE_SOURCE, route);

  const handleClick = useEffectEvent((point: ScreenPoint) => {
    const hit = pick(point);
    if (!hit) return;
    if (hit.kind === 'facility') onSelect(hit.id);
    else if (scene.selected) onDeselect();
  });
  const pickKey = useEffectEvent((point: ScreenPoint) => {
    const hit = pick(point);
    return hit ? (hit.kind === 'home' ? 'home' : hit.id) : null;
  });
  const cachedThemeRef = useRef<ReturnType<typeof readPinTheme> | null>(null);
  const appliedThemeRef = useRef<Theme | null>(null);
  useEffect(() => {
    if (!map) return undefined;
    const canvas = map.getCanvas();
    canvas.setAttribute('aria-describedby', hintId);
    // 外側の地図 region と同名のランドマークを重ねない。
    canvas.setAttribute('role', 'group');
    const getTheme = () => {
      if (!cachedThemeRef.current) cachedThemeRef.current = readPinTheme(map.getContainer());
      return cachedThemeRef.current;
    };
    const applyTheme = () => {
      if (!map.getLayer(ROUTE_SOURCE)) return;
      const accent = getTheme().accent;
      if (map.getPaintProperty(ROUTE_SOURCE, 'line-color') !== accent) {
        map.setPaintProperty(ROUTE_SOURCE, 'line-color', accent);
      }
    };
    map.on('styledata', applyTheme);
    applyTheme();
    const addMissingPin = (id: string) => {
      const face = parsePinImageId(id);
      if (!face || map.hasImage(id)) return;
      const pixelRatio = map.getPixelRatio();
      map.addImage(id, pinImage(face, getTheme(), pixelRatio), {
        pixelRatio,
      });
    };
    const click = (event: MapMouseEvent) => {
      handleClick(event.point);
    };
    let frame: number | null = null;
    const clearCursor = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      map.getCanvas().style.cursor = '';
    };
    const scheduleRefreshCursor = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        refreshCursor();
      });
    };
    const resetCursor = () => {
      hoverPoint.current = null;
      clearCursor();
    };
    const hover = (event: MapMouseEvent) => {
      hoverPoint.current = event.point;
      if (event.originalEvent.buttons) {
        clearCursor();
        return;
      }
      scheduleRefreshCursor();
    };
    // v6 の styleimagemissing は応答後の通知なので、生成は応答前に呼ばれる resolver に登録する。
    map.setMissingStyleImageResolver(addMissingPin);
    const sourceChanged = (event: MapSourceDataEvent) => {
      if (hoverPoint.current && PIN_LAYERS.some((layer) => layer.source === event.sourceId)) scheduleRefreshCursor();
    };
    map.on('sourcedataloading', sourceChanged);
    map.on('sourcedata', sourceChanged);
    map.on('moveend', refreshCursor);
    map.on('click', click);
    map.on('mousemove', hover);
    map.on('mouseout', resetCursor);
    map.on('dragstart', resetCursor);
    map.on('boxzoomstart', resetCursor);
    const removeProbe = installPinProbe(map, pickKey);
    return () => {
      resetCursor();
      map.setMissingStyleImageResolver(null);
      canvas.removeAttribute('aria-describedby');
      canvas.removeAttribute('role');
      map.off('styledata', applyTheme);
      map.off('sourcedataloading', sourceChanged);
      map.off('sourcedata', sourceChanged);
      map.off('moveend', refreshCursor);
      map.off('click', click);
      map.off('mousemove', hover);
      map.off('mouseout', resetCursor);
      map.off('dragstart', resetCursor);
      map.off('boxzoomstart', resetCursor);
      removeProbe();
    };
  }, [map, hintId]);
  useEffect(() => {
    if (!map) return;
    if (appliedThemeRef.current === theme) return;
    const isSwitch = appliedThemeRef.current !== null;
    appliedThemeRef.current = theme;
    cachedThemeRef.current = null;
    if (!isSwitch) return;
    const nextTheme = readPinTheme(map.getContainer());
    cachedThemeRef.current = nextTheme;
    const pixelRatio = map.getPixelRatio();
    for (const id of map.listImages()) {
      const face = parsePinImageId(id);
      if (face) map.updateImage(id, pinImage(face, nextTheme, pixelRatio));
    }
    if (map.getLayer(ROUTE_SOURCE) && map.getPaintProperty(ROUTE_SOURCE, 'line-color') !== nextTheme.accent) {
      map.setPaintProperty(ROUTE_SOURCE, 'line-color', nextTheme.accent);
    }
  }, [map, theme]);
  return null;
}

function useSourceData(map: MapLibreMap | undefined, id: string, data: GeoJSON) {
  const syncOnStyleLoad = useEffectEvent(() => {
    const source = map?.getSource<GeoJSONSource>(id);
    if (source) void source.setData(data);
  });
  useEffect(() => {
    if (!map) return undefined;
    const apply = () => {
      const source = map.getSource<GeoJSONSource>(id);
      if (!source) return false;
      void source.setData(data);
      return true;
    };
    if (apply()) return undefined;
    // インラインのスタイルは次のフレームまで source を公開しないことがある。
    const retry = () => {
      if (apply()) map.off('styledata', retry);
    };
    map.on('styledata', retry);
    return () => {
      map.off('styledata', retry);
    };
  }, [map, id, data]);
  useEffect(() => {
    if (!map) return undefined;
    map.on('style.load', syncOnStyleLoad);
    return () => {
      map.off('style.load', syncOnStyleLoad);
    };
  }, [map]);
}
