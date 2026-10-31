import { useEffect, useEffectEvent, useMemo, useRef } from 'react';
import { useMap } from 'react-map-gl/maplibre';
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent, MapSourceDataEvent } from 'maplibre-gl';
import type { GeoJSON } from 'geojson';
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
  type PinScene,
  type ScreenPoint,
} from './pin-layers';
import { installPinProbe } from './pin-probe';

export function PinOverlay({
  hintId,
  facilities,
  allFacilities,
  vacancyOf,
  selectedId,
  home,
  onSelect,
}: {
  hintId: string;
  facilities: Facility[];
  allFacilities: Facility[];
  vacancyOf: (facility: Facility) => number;
  selectedId: string | null;
  home: Home | null;
  onSelect: (id: string) => void;
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
  const scene: PinScene = { facilities: base.pins, selected: selected.pin, home: homeAt.pin };
  const pick = useEffectEvent((point: ScreenPoint) => (map ? pickPin(scene, point, (lngLat) => map.project(lngLat)) : null));
  const hoverPoint = useRef<ScreenPoint | null>(null);
  const refreshCursor = useEffectEvent(() => {
    if (map) map.getCanvas().style.cursor = hoverPoint.current && pick(hoverPoint.current) ? 'pointer' : '';
  });
  useSourceData(map, 'facility-pins', base.data);
  useSourceData(map, 'facility-pin-selected', selected.data);
  useSourceData(map, 'home-pin', homeAt.data);
  useSourceData(map, ROUTE_SOURCE, route);

  const select = useEffectEvent((id: string) => onSelect(id));
  useEffect(() => {
    if (!map) return undefined;
    const canvas = map.getCanvas();
    canvas.setAttribute('aria-describedby', hintId);
    // 外側の地図 region と同名のランドマークを重ねない。
    canvas.setAttribute('role', 'group');
    const applyTheme = () => {
      if (!map.getLayer(ROUTE_SOURCE)) return;
      map.setPaintProperty(ROUTE_SOURCE, 'line-color', readPinTheme(map.getContainer()).accent);
      map.off('styledata', applyTheme);
    };
    map.on('styledata', applyTheme);
    applyTheme();
    const addMissingPin = (id: string) => {
      const face = parsePinImageId(id);
      if (!face || map.hasImage(id)) return;
      map.addImage(id, pinImage(face, readPinTheme(map.getContainer()), map.getPixelRatio()), {
        pixelRatio: map.getPixelRatio(),
      });
    };
    const click = (event: MapMouseEvent) => {
      const id = pick(event.point);
      if (id) select(id);
    };
    let frame: number | null = null;
    const clearCursor = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      map.getCanvas().style.cursor = '';
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
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        refreshCursor();
      });
    };
    // v6 の styleimagemissing は応答後の通知なので、生成は応答前に呼ばれる resolver に登録する。
    map.setMissingStyleImageResolver(addMissingPin);
    const sourceChanged = (event: MapSourceDataEvent) => {
      if (PIN_LAYERS.some((layer) => layer.source === event.sourceId)) refreshCursor();
    };
    map.on('sourcedataloading', sourceChanged);
    map.on('sourcedata', sourceChanged);
    map.on('moveend', refreshCursor);
    map.on('click', click);
    map.on('mousemove', hover);
    map.on('mouseout', resetCursor);
    map.on('dragstart', resetCursor);
    const removeProbe = installPinProbe(map, pick);
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
      removeProbe();
    };
  }, [map, hintId]);
  return null;
}

function useSourceData(map: MapLibreMap | undefined, id: string, data: GeoJSON) {
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
}
