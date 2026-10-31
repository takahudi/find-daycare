import type { FilterSpecification, GeoJSONSourceSpecification, LayerSpecification, SymbolLayerSpecification } from 'maplibre-gl';
import type { Facility, Home } from '../../schema.ts';
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
} from './pin-face.ts';

export interface FacilityPin {
  readonly id: string;
  readonly lng: number;
  readonly lat: number;
  readonly face: FacilityFace;
}
export interface HomePin {
  readonly id: 'home';
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
  return home && { id: 'home', lng: home.lng, lat: home.lat, face: HOME_FACE };
}

type PinSourceId = 'facility-pins' | 'facility-pin-selected' | 'home-pin';
export const PIN_LAYERS = [
  {
    id: 'facility-pins-full',
    source: 'facility-pins',
    tier: 'full',
    pins: (scene: PinScene) => scene.facilities.filter((pin) => pinTier(pin.face) === 'full'),
    position: tiledFacilityPosition,
  },
  {
    id: 'facility-pins-open',
    source: 'facility-pins',
    tier: 'open',
    pins: (scene: PinScene) => scene.facilities.filter((pin) => pinTier(pin.face) === 'open'),
    position: tiledFacilityPosition,
  },
  {
    id: 'facility-pin-selected',
    source: 'facility-pin-selected',
    tier: null,
    pins: (scene: PinScene) => (scene.selected ? [scene.selected] : []),
    position: exactPinPosition,
  },
  {
    id: 'home-pin',
    source: 'home-pin',
    tier: null,
    pins: (scene: PinScene) => (scene.home ? [scene.home] : []),
    position: exactPinPosition,
  },
] as const satisfies readonly {
  id: string;
  source: PinSourceId;
  tier: PinTier | null;
  pins: (scene: PinScene) => readonly (FacilityPin | HomePin)[];
  position: (pin: FacilityPin | HomePin) => [number, number];
}[];
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
        key: pin.id,
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
      paint: { 'line-width': 3, 'line-dasharray': [2, 2] },
    },
    ...PIN_LAYERS.map(symbol),
  ];
}
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}
function exactPinPosition(pin: FacilityPin | HomePin): [number, number] {
  return [pin.lng, pin.lat];
}
// MapLibre の geojson-vt は Mercator 座標を extent 8192 の整数へ丸める。
// 元座標を投影すると、z17 では描画位置から最大4pxずつ外れる。
export function tiledFacilityPosition(pin: FacilityPin | HomePin): [number, number] {
  const units = 8192 * 2 ** FACILITY_PINS_MAXZOOM;
  const x = Math.round((pin.lng / 360 + 0.5) * units) / units;
  const sin = Math.sin((pin.lat * Math.PI) / 180);
  const y = Math.round((0.5 - (0.25 * Math.log((1 + sin) / (1 - sin))) / Math.PI) * units) / units;
  return [(x - 0.5) * 360, (360 * Math.atan(Math.exp(((180 - y * 360) * Math.PI) / 180))) / Math.PI - 90];
}
export function pickPin(scene: PinScene, point: ScreenPoint, project: (lngLat: [number, number]) => ScreenPoint): string | null {
  for (const layer of PIN_LAYERS.toReversed()) {
    for (const pin of layer.pins(scene).toReversed()) {
      const position = project(layer.position(pin));
      if (pinContains(pin.face, point.x - position.x, point.y - position.y)) return pin.face.kind === 'facility' ? pin.id : null;
    }
  }
  return null;
}
