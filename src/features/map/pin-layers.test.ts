import { describe, expect, it } from 'vitest';
import { featureFilter } from '@maplibre/maplibre-gl-style-spec';
import data from '../../data/facilities.json';
import type { Facility } from '../../schema';
import { parse } from 'valibot';
import { DatasetSchema } from '../../schema';
import {
  FACILITY_PINS_MAXZOOM,
  PIN_LAYERS,
  facilityPins,
  homePin,
  pickPin,
  pinCollection,
  pinLayerFilter,
  routeCollection,
  selectedPin,
  type PinScene,
} from './pin-layers';
import { createMapStyle } from './map-style';

const facilities = parse(DatasetSchema, data).facilities;
const facility = (id: string, lat: number, lng: number, licensing: Facility['licensing'] = 'licensed'): Facility => ({
  ...facilities[0],
  id,
  lat,
  lng,
  licensing,
});
const project = ([lng, lat]: [number, number]) => ({ x: lng * 1000, y: -lat * 1000 });
const scene = (parts: Partial<PinScene>): PinScene => ({ facilities: [], selected: null, home: null, ...parts });

describe('施設ピンの重なり順', () => {
  it('北から南の順に並び、同じ緯度はデータの順を保つ', () => {
    const all = [facility('a', 34.6, 135.5), facility('b', 34.7, 135.5), facility('c', 34.6, 135.6)];
    expect(facilityPins(all, [...all].reverse(), () => 1).map((pin) => pin.id)).toEqual(['b', 'a', 'c']);
    expect(facilityPins(all, [all[2]], () => 1).map((pin) => pin.id)).toEqual(['c']);
  });
  it('どの施設ピンもちょうど1つの段のレイヤーに入り、空きの有無と一致する', () => {
    const pins = facilityPins(facilities, facilities, (f) => (f.id.length % 2 ? 0 : 3));
    for (const feature of pinCollection(pins).features) {
      const matches = PIN_LAYERS.filter((layer) => layer.source === 'facility-pins').filter((layer) =>
        featureFilter(pinLayerFilter(layer), `layers.${layer.id}.filter`).filter(
          { zoom: 12 },
          { type: 1, properties: feature.properties, geometry: [] },
        ),
      );
      expect(matches.map((layer) => layer.tier)).toEqual([feature.properties.tier]);
    }
  });
  it('全施設がz10のタイル1列に収まる', () => {
    expect(new Set(facilities.map((f) => Math.floor(((f.lng + 180) / 360) * 2 ** FACILITY_PINS_MAXZOOM))).size).toBe(1);
  });
  it('地図は経路・空きなし・空きあり・選択中・自宅の順に重ね、文字は画像に含める', () => {
    const style = createMapStyle('https://daycare.test');
    expect(style.layers.slice(-5).map((layer) => layer.id)).toEqual([
      'home-route',
      'facility-pins-full',
      'facility-pins-open',
      'facility-pin-selected',
      'home-pin',
    ]);
    for (const layer of style.layers.slice(-4)) {
      expect(layer).toMatchObject({
        type: 'symbol',
        layout: {
          'icon-image': ['get', 'image'],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'symbol-z-order': 'source',
        },
      });
      expect(layer.layout).not.toHaveProperty('text-field');
    }
    expect(style.sources['facility-pins']).toMatchObject({ type: 'geojson', maxzoom: 10 });
    expect(style.sources['facility-pin-selected']).not.toHaveProperty('maxzoom');
    expect(style.sources['home-pin']).not.toHaveProperty('maxzoom');
  });
});
describe('ピンのクリック', () => {
  it('選択中 > 空きあり > 空きなし の順で手前を選ぶ', () => {
    const all = [facility('f', 0, 0), facility('o', 0, 0)];
    const pins = facilityPins(all, all, (f) => (f.id === 'o' ? 1 : 0));
    expect(pickPin(scene({ facilities: pins }), { x: 0, y: 0 }, project)).toBe('o');
    expect(pickPin(scene({ facilities: pins, selected: selectedPin(pins, 'f') }), { x: 0, y: 0 }, project)).toBe('f');
  });
  it('同じ段では南を選び、同じ緯度ではデータの後の施設を選ぶ', () => {
    const all = [facility('south', 0, 0), facility('north', 0.01, 0)];
    expect(pickPin(scene({ facilities: facilityPins(all, all, () => 1) }), { x: 0, y: -5 }, project)).toBe('south');
    const tied = [facility('a', 0, 0), facility('b', 0, 0)];
    expect(pickPin(scene({ facilities: facilityPins(tied, tied, () => 1) }), { x: 0, y: 0 }, project)).toBe('b');
  });
  it('自宅ピンの下では施設を選ばず、自宅の外では施設を選ぶ', () => {
    const all = [facility('a', 0, 0.02)];
    const state = scene({ facilities: facilityPins(all, all, () => 1), home: homePin({ lat: 0, lng: 0, label: '自宅' }) });
    expect(pickPin(state, { x: 10, y: 0 }, project)).toBeNull();
    expect(pickPin(state, { x: 20, y: 0 }, project)).toBe('a');
  });
  it('丸の角・影・何もない所では選ばず、四角の角では選ぶ', () => {
    const circle = [facility('circle', 0, 0)];
    const square = [facility('square', 0, 0, 'unlicensed')];
    expect(pickPin(scene({ facilities: facilityPins(circle, circle, () => 1) }), { x: 12, y: 12 }, project)).toBeNull();
    expect(pickPin(scene({ facilities: facilityPins(square, square, () => 1) }), { x: 12, y: 12 }, project)).toBe('square');
    for (const x of [17, 100])
      expect(pickPin(scene({ facilities: facilityPins(circle, circle, () => 1) }), { x, y: 0 }, project)).toBeNull();
  });
  it('自宅と選択施設が揃ったときだけ、その2点を経路で結ぶ', () => {
    const all = [facility('a', 1, 2)];
    const selected = selectedPin(
      facilityPins(all, all, () => 1),
      'a',
    );
    const home = homePin({ lat: 3, lng: 4, label: '自宅' });
    expect(routeCollection(home, selected).features[0].geometry.coordinates).toEqual([
      [4, 3],
      [2, 1],
    ]);
    expect(routeCollection(null, selected).features).toEqual([]);
    expect(routeCollection(home, null).features).toEqual([]);
  });
});
