import type { FilterSpecification, GeoJSONSourceSpecification, LayerSpecification, SymbolLayerSpecification } from 'maplibre-gl';
import type { Facility, Home } from '../../schema';
import type * as GeoJSON from 'geojson';
import {
  facilityFace,
  HOME_FACE,
  pinContains,
  pinImageId,
  pinTier,
  type FacilityFace,
  type HomeFace,
  type PinTier,
} from './pin-face';

export interface FacilityPin {
  readonly id: string;
  readonly lng: number;
  readonly lat: number;
  readonly face: FacilityFace;
}
export interface HomePin {
  readonly lng: number;
  readonly lat: number;
  readonly face: HomeFace;
}
export interface PinScene {
  readonly facilities: readonly FacilityPin[];
  readonly selected: FacilityPin | null;
  readonly home: HomePin | null;
}
export function facilityPins(
  all: readonly Facility[],
  visible: readonly Facility[],
  vacancyOf: (facility: Facility) => number,
): readonly FacilityPin[] {
  const ids = new Set(visible.map((facility) => facility.id));
  return [...all]
    .sort((a, b) => b.lat - a.lat)
    .filter((facility) => ids.has(facility.id))
    .map((facility) => ({
      id: facility.id,
      lng: facility.lng,
      lat: facility.lat,
      face: facilityFace(facility, vacancyOf(facility), false),
    }));
}
export function selectedPin(pins: readonly FacilityPin[], selectedId: string | null): FacilityPin | null {
  const pin = pins.find((candidate) => candidate.id === selectedId);
  return pin ? { ...pin, face: { ...pin.face, selected: true } } : null;
}
export function homePin(home: Home | null): HomePin | null {
  return home && { lng: home.lng, lat: home.lat, face: HOME_FACE };
}

type PinSourceId = 'facility-pins' | 'facility-pin-selected' | 'home-pin';
export const PIN_LAYERS = [
  { id: 'facility-pins-full', source: 'facility-pins', tier: 'full' },
  { id: 'facility-pins-open', source: 'facility-pins', tier: 'open' },
  { id: 'facility-pin-selected', source: 'facility-pin-selected', tier: null },
  { id: 'home-pin', source: 'home-pin', tier: null },
] as const satisfies readonly { id: string; source: PinSourceId; tier: PinTier | null }[];
export type PinLayer = (typeof PIN_LAYERS)[number];
export type PinLayerId = PinLayer['id'];
export const PIN_LAYER_IDS: readonly PinLayerId[] = PIN_LAYERS.map((layer) => layer.id);
export const ROUTE_SOURCE = 'home-route';
// タイルの描画順は列が優先される。z10 の1列に収め、南のピンが手前になる順を列境界でも保つ。
export const FACILITY_PINS_MAXZOOM = 10;
export interface PinProperties {
  readonly key: string;
  readonly image: string;
  readonly tier?: PinTier;
}
export type PinCollection = GeoJSON.FeatureCollection<GeoJSON.Point, PinProperties>;
export function pinCollection(pins: readonly (FacilityPin | HomePin)[]): PinCollection {
  return {
    type: 'FeatureCollection',
    features: pins.map((pin) => ({
      type: 'Feature',
      properties: {
        key: 'id' in pin ? pin.id : 'home',
        image: pinImageId(pin.face),
        ...(pin.face.kind === 'facility' ? { tier: pinTier(pin.face) } : {}),
      },
      geometry: { type: 'Point', coordinates: [pin.lng, pin.lat] },
    })),
  };
}
export function routeCollection(
  home: HomePin | null,
  selected: FacilityPin | null,
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: 'FeatureCollection',
    features:
      home && selected
        ? [
            {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: [
                  [home.lng, home.lat],
                  [selected.lng, selected.lat],
                ],
              },
            },
          ]
        : [],
  };
}
export function pinSources(): Record<PinSourceId | typeof ROUTE_SOURCE, GeoJSONSourceSpecification> {
  const empty = (): GeoJSONSourceSpecification => ({ type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  return {
    'facility-pins': { ...empty(), maxzoom: FACILITY_PINS_MAXZOOM },
    'facility-pin-selected': empty(),
    'home-pin': empty(),
    [ROUTE_SOURCE]: empty(),
  };
}
export function pinLayerFilter(layer: PinLayer): FilterSpecification | undefined {
  return layer.tier ? ['==', ['get', 'tier'], layer.tier] : undefined;
}
export function pinLayers(): LayerSpecification[] {
  const symbol = (layer: PinLayer): SymbolLayerSpecification => ({
    id: layer.id,
    type: 'symbol',
    source: layer.source,
    ...(layer.tier ? { filter: pinLayerFilter(layer) } : {}),
    layout: {
      'icon-image': ['get', 'image'],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'symbol-z-order': 'source',
    },
  });
  return [
    {
      id: ROUTE_SOURCE,
      type: 'line',
      source: ROUTE_SOURCE,
      paint: { 'line-color': '#e8743b', 'line-width': 3, 'line-dasharray': [2, 2] },
    },
    ...PIN_LAYERS.map(symbol),
  ];
}
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}
function pinsOf(scene: PinScene, layer: PinLayer): readonly (FacilityPin | HomePin)[] {
  if (layer.source === 'home-pin') return scene.home ? [scene.home] : [];
  if (layer.source === 'facility-pin-selected') return scene.selected ? [scene.selected] : [];
  return scene.facilities.filter((pin) => pinTier(pin.face) === layer.tier);
}
export function pickPin(scene: PinScene, point: ScreenPoint, project: (lngLat: [number, number]) => ScreenPoint): string | null {
  for (const layer of PIN_LAYERS.toReversed()) {
    for (const pin of pinsOf(scene, layer).toReversed()) {
      const position = project([pin.lng, pin.lat]);
      if (pinContains(pin.face, point.x - position.x, point.y - position.y)) return 'id' in pin ? pin.id : null;
    }
  }
  return null;
}
