import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import rawData from './data/facilities.json';
import { DatasetSchema, FacilitySchema, HomeSchema, type Dataset } from './schema';
import { parseJson } from '../scripts/json';

const dataset = () => v.parse(DatasetSchema, structuredClone(rawData));

function expectFacilityIssue(data: Dataset, id: string) {
  const result = v.safeParse(DatasetSchema, data);
  expect(result.success).toBe(false);
  if (!result.success) expect(result.issues.some((issue) => issue.message.includes(id))).toBe(true);
}

describe('公開データ', () => {
  it('コミット済みのfacilities.jsonがスキーマと不変条件を満たす', () => {
    const result = v.safeParse(DatasetSchema, rawData);
    expect(result.success, result.issues ? v.summarize(result.issues) : undefined).toBe(true);
  });

  it('共有枠と該当年齢の人数が違う場合は施設ID付きで拒否する', () => {
    const data = dataset();
    const f = data.facilities.find((facility) => facility.sharedVacancy);
    if (!f?.sharedVacancy) throw new Error('共有枠のある施設が必要です');
    f.vacancies[f.sharedVacancy.ages[0]] = f.sharedVacancy.count + 1;
    expectFacilityIssue(data, f.id);
  });

  it.each([
    ['1年齢のみ', [1]],
    ['同じ年齢の重複', [1, 1]],
    ['範囲外の年齢', [1, 6]],
    ['整数でない年齢', [1, 1.5]],
    ['空配列', []],
  ])('共有枠が%sなら施設ID付きで拒否する', (_label, ages) => {
    const data = dataset();
    const f = data.facilities[0];
    f.vacancies = [0, 0, 0, 0, 0, 0];
    f.sharedVacancy = { ages, count: 0 };
    expectFacilityIssue(data, f.id);
  });

  it('人数0の共有枠を受け付ける', () => {
    const f = dataset().facilities[0];
    f.vacancies = [null, 0, 0, null, null, null];
    f.sharedVacancy = { ages: [1, 2], count: 0 };
    expect(v.safeParse(FacilitySchema, f).success).toBe(true);
  });

  it('空き人数が6件でなければ施設ID付きで拒否する', () => {
    const data = dataset();
    data.facilities[0].vacancies.pop();
    expectFacilityIssue(data, data.facilities[0].id);
  });

  it.each([-1, 1.5])('空き人数%sを拒否する', (n) => {
    const f = dataset().facilities[0];
    f.vacancies[0] = n;
    expect(v.safeParse(FacilitySchema, f).success).toBe(false);
  });

  it('同じ施設IDを複数回掲載できない', () => {
    const data = dataset();
    data.facilities.push(structuredClone(data.facilities[0]));
    expectFacilityIssue(data, data.facilities[0].id);
  });

  it.each(['missing', 'name'])('区の対応が不正な場合は施設ID付きで拒否する (%s)', (mode) => {
    const data = dataset();
    const f = data.facilities[0];
    if (mode === 'missing') f.ward = 'unknown';
    else f.wardName = '存在しない区';
    expectFacilityIssue(data, f.id);
  });

  it('施設のない区を区ID付きで拒否する', () => {
    const data = dataset();
    const ward = data.wards[0];
    data.facilities = data.facilities.filter((f) => f.ward !== ward.id);
    const result = v.safeParse(DatasetSchema, data);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.some((issue) => issue.message.includes(ward.id))).toBe(true);
  });

  it('重複した区を区ID付きで拒否する', () => {
    const data = dataset();
    data.wards.push(structuredClone(data.wards[0]));
    const result = v.safeParse(DatasetSchema, data);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.some((issue) => issue.message.includes(data.wards[0].id))).toBe(true);
  });

  it.each(['nursery', 'kigyo'] as const)('種別%sと認可区分の不整合を施設ID付きで拒否する', (category) => {
    const data = dataset();
    const f = data.facilities[0];
    f.category = category;
    f.licensed = category === 'kigyo';
    expectFacilityIssue(data, f.id);
  });

  it('大阪市外の施設座標を施設ID付きで拒否する', () => {
    const data = dataset();
    data.facilities[0].lat = 35;
    expectFacilityIssue(data, data.facilities[0].id);
  });

  it('定員内訳の超過と合計の不一致を拒否する', () => {
    const f = dataset().facilities[0];
    for (const capacity of [
      { total: 7, byAge: [1, 1, 1, 1, 1, 1, 1] },
      { total: 20, byAge: [5, 5] },
    ]) {
      expect(v.safeParse(FacilitySchema, { ...f, capacity }).success).toBe(false);
    }
  });

  it.each(['javascript:alert(1)', 'ftp://example.com/file', 'URLではない文字列'])(
    'HTTP以外や不正なURLを拒否する (%s)',
    (website) => {
      expect(v.safeParse(FacilitySchema, { ...dataset().facilities[0], website }).success).toBe(false);
    },
  );
});

describe('自宅の保存データ', () => {
  it.each([
    null,
    {},
    { lat: '34.69', lng: 135.5, label: '自宅' },
    { lat: 91, lng: 135.5, label: '自宅' },
    { lat: 34.69, lng: 181, label: '自宅' },
    { lat: 34.69, lng: 135.5, label: '' },
  ])('壊れた値を拒否する (%j)', (home) => {
    expect(v.safeParse(HomeSchema, home).success).toBe(false);
  });

  it('大阪市外の現在地も保存できる', () => {
    expect(v.safeParse(HomeSchema, { lat: 35.68, lng: 139.76, label: '現在地' }).success).toBe(true);
  });
});

describe('補完入力のJSON境界', () => {
  it('注記キーを除いてからwebsitesを検証する', () => {
    expect(parseJson('{"_source": "出典", "施設": {"url": "https://example.com", "label": "公式"}}', 'websites.json')).toEqual({
      施設: { url: 'https://example.com', label: '公式' },
    });
  });

  it('注記キーを除いても不正な施設データを拒否する', () => {
    expect(() => parseJson('{"_note": "補正理由", "施設": {"url": 1, "label": "公式"}}', 'websites.json')).toThrow();
  });

  it('注記対象外のファイルでは_キーも検証する', () => {
    expect(() => parseJson('{"_broken": "注記として許可されない"}', 'geocode-cache.json')).toThrow();
  });

  it('GSI応答の座標と名称を検証する', () => {
    expect(
      parseJson('[{"geometry":{"coordinates":[135.5,34.69]},"properties":{"title":"大阪市北区中之島"}}]', 'geocode-response'),
    ).toHaveLength(1);
    expect(() =>
      parseJson('[{"geometry":{"coordinates":["135.5",34.69]},"properties":{"title":"大阪市北区中之島"}}]', 'geocode-response'),
    ).toThrow();
  });
});
