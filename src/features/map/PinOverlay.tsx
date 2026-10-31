import { useEffect, useEffectEvent, useMemo } from 'react';
import { useMap } from 'react-map-gl/maplibre';
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import type { GeoJSON } from 'geojson';
import type { Facility, Home } from '../../schema';
import { parsePinImageId } from './pin-face';
import { pinImage, readPinTheme } from './pin-paint';
import {
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
  facilities,
  allFacilities,
  vacancyOf,
  selectedId,
  home,
  onSelect,
}: {
  facilities: Facility[];
  allFacilities: Facility[];
  vacancyOf: (facility: Facility) => number;
  selectedId: string | null;
  home: Home | null;
  onSelect: (id: string) => void;
}) {
  const map = useMap().current?.getMap();
  // Compiler は effect event が読む scene の計算をキャッシュしないため、source の同一性をここで保つ。
  const base = useMemo(() => {
    const pins = facilityPins(allFacilities, facilities, vacancyOf);
    return { pins, data: pinCollection(pins) };
  }, [allFacilities, facilities, vacancyOf]);
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
  useSourceData(map, 'facility-pins', base.data);
  useSourceData(map, 'facility-pin-selected', selected.data);
  useSourceData(map, 'home-pin', homeAt.data);
  useSourceData(map, ROUTE_SOURCE, route);

  const pick = useEffectEvent((point: ScreenPoint) => (map ? pickPin(scene, point, (lngLat) => map.project(lngLat)) : null));
  const select = useEffectEvent((id: string) => onSelect(id));
  useEffect(() => {
    if (!map) return undefined;
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
    let hoverPoint: ScreenPoint | null = null;
    const resetCursor = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      hoverPoint = null;
      map.getCanvas().style.cursor = '';
    };
    const hover = (event: MapMouseEvent) => {
      if (event.originalEvent.buttons) {
        resetCursor();
        return;
      }
      hoverPoint = event.point;
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        map.getCanvas().style.cursor = hoverPoint && pick(hoverPoint) ? 'pointer' : '';
      });
    };
    // v6 の styleimagemissing は応答後の通知なので、生成は応答前に呼ばれる resolver に登録する。
    map.setMissingStyleImageResolver(addMissingPin);
    map.on('click', click);
    map.on('mousemove', hover);
    map.on('mouseout', resetCursor);
    map.on('dragstart', resetCursor);
    const removeProbe = installPinProbe(map, pick);
    return () => {
      resetCursor();
      map.setMissingStyleImageResolver(null);
      map.off('click', click);
      map.off('mousemove', hover);
      map.off('mouseout', resetCursor);
      map.off('dragstart', resetCursor);
      removeProbe();
    };
  }, [map]);
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
