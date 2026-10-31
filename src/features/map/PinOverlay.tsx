import { useEffect, useEffectEvent } from 'react';
import { useMap } from 'react-map-gl/maplibre';
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent, MapStyleImageMissingEvent } from 'maplibre-gl';
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
  const pins = facilityPins(allFacilities, facilities, vacancyOf);
  const selected = selectedPin(pins, selectedId);
  const homeAt = homePin(home);
  const scene: PinScene = { facilities: pins, selected, home: homeAt };
  useSourceData(map, 'facility-pins', pinCollection(pins));
  useSourceData(map, 'facility-pin-selected', pinCollection(selected ? [selected] : []));
  useSourceData(map, 'home-pin', pinCollection(homeAt ? [homeAt] : []));
  useSourceData(map, ROUTE_SOURCE, routeCollection(homeAt, selected));

  const pick = useEffectEvent((point: ScreenPoint) => (map ? pickPin(scene, point, (lngLat) => map.project(lngLat)) : null));
  const select = useEffectEvent((id: string) => onSelect(id));
  useEffect(() => {
    if (!map) return undefined;
    const addMissingPin = ({ id }: MapStyleImageMissingEvent) => {
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
    map.on('styleimagemissing', addMissingPin);
    map.on('click', click);
    map.on('mousemove', hover);
    map.on('mouseout', resetCursor);
    map.on('dragstart', resetCursor);
    const removeProbe = installPinProbe(map, pick);
    return () => {
      resetCursor();
      map.off('styleimagemissing', addMissingPin);
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
