import { describe, expect, it } from 'vitest';
import { namedFlavor } from '@protomaps/basemaps';
import indexCss from '../../index.css?raw';
import {
  facilityFace,
  HOME_FACE,
  PIN_THEME_VARS,
  parsePinImageId,
  pinColors,
  pinContains,
  pinGeometry,
  pinImageId,
  pinTheme,
  type FacilityFace,
  type PinFace,
} from './pin-face';

const variables = new Map(
  [.../:root\s*\{([^}]+)\}/.exec(indexCss)![1].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]),
);
const theme = pinTheme((name) => variables.get(name)!, 'sans-serif');
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const full =
      hex.length === 4
        ? hex
            .slice(1)
            .split('')
            .map((c) => c + c)
            .join('')
        : hex.slice(1);
    const [red, green, blue] = [0, 2, 4]
      .map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
const facilityFaces: FacilityFace[] = (['circle', 'square'] as const).flatMap((shape) =>
  [0, 1, 66].flatMap((vacancy) => [false, true].map((selected) => ({ kind: 'facility', shape, vacancy, selected }) as const)),
);
const allFaces: PinFace[] = [...facilityFaces, HOME_FACE];

describe('ピンの画像ID', () => {
  it('すべての見た目が画像IDから元に戻る', () => {
    for (const face of allFaces) expect(parsePinImageId(pinImageId(face))).toEqual(face);
  });
  it('ベースマップのスプライトや壊れたIDはピンとして扱わない', () => {
    for (const id of [
      'townhall',
      'pin:',
      'pin:home:x',
      'pin:circle:-1',
      'pin:circle:1.5',
      'pin:circle:01',
      'pin:hexagon:1',
      'pin:circle:1:x',
      'pin:circle:9007199254740992',
    ])
      expect(parsePinImageId(id)).toBeNull();
  });
});
describe('ピンの形', () => {
  it('認可は丸、認可外は角の丸い四角で従来の大きさと縁を保つ', () => {
    expect(pinGeometry(facilityFace({ licensing: 'licensed' }, 1, false), 'map')).toMatchObject({
      box: 30,
      border: 2,
      corner: 15,
      scale: 1,
      ring: 0,
    });
    expect(pinGeometry(facilityFace({ licensing: 'unlicensed' }, 1, false), 'map')).toMatchObject({
      box: 30,
      border: 2,
      corner: 7,
    });
    expect(pinGeometry(HOME_FACE, 'map')).toMatchObject({ box: 34, corner: 17, label: '家' });
  });
  it('選択中は1.2倍でアクセントの輪が付き、空きなしは×を表示する', () => {
    expect(pinGeometry(facilityFace({ licensing: 'unlicensed' }, 0, true), 'map')).toMatchObject({
      scale: 1.2,
      ring: 3,
      label: '×',
    });
  });
  it('凡例は20pxの同じ形', () => {
    expect(pinGeometry(facilityFace({ licensing: 'unlicensed' }, 1, false), 'legend')).toMatchObject({
      box: 20,
      border: 1.5,
      corner: 7,
    });
  });
  it('当たり判定は描く形と同じで、影と輪は含めない', () => {
    const circle = facilityFace({ licensing: 'licensed' }, 1, false);
    expect(pinContains(facilityFace({ licensing: 'unlicensed' }, 1, false), 12, 12)).toBe(true);
    expect(pinContains(circle, 12, 12)).toBe(false);
    expect(pinContains({ ...circle, selected: true }, 17.5, 0)).toBe(true);
    expect(pinContains({ ...circle, selected: true }, 19, 0)).toBe(false);
    expect(pinContains(circle, 15.5, 0)).toBe(false);
  });
});
describe('ピンの色の対比', () => {
  it('テーマはindex.cssの変数から決まる', () => {
    for (const name of Object.values(PIN_THEME_VARS)) expect(variables.has(name), name).toBe(true);
  });
  it('数字・×・家の文字は塗りに対して4.5:1以上', () => {
    for (const face of allFaces) {
      const { fill, text } = pinColors(face, theme);
      expect(contrast(text, fill), pinImageId(face)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('施設ピンは塗りか縁がベースマップの地色に対して3:1以上', () => {
    const flavor = namedFlavor('light');
    for (const ground of [flavor.earth, flavor.park_a, flavor.water, flavor.background]) {
      for (const face of facilityFaces) {
        const { fill, border } = pinColors(face, theme);
        expect(
          Math.max(contrast(fill, ground), contrast(border, ground)),
          `${pinImageId(face)} on ${ground}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });
  it('認可外だけが茶色の縁を持つ', () => {
    for (const face of facilityFaces)
      expect(pinColors(face, theme).border === theme.unlicensed, pinImageId(face)).toBe(face.shape === 'square');
  });
});

it('観測した自宅の見た目を書き換えても共有の見た目を変えられない', () => {
  const face = parsePinImageId('pin:home')!;
  Reflect.set(face, 'kind', 'facility');
  expect(parsePinImageId('pin:home')).toEqual({ kind: 'home' });
});
