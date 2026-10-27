import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import rawData from './data/facilities.json';
import {
  DatasetSchema,
  FacilitySchema,
  FacilityTypeSchema,
  HomeSchema,
  WardSchema,
  LICENSING_BY_FACILITY_TYPE,
  type Dataset,
} from './schema';

const dataset = () => v.parse(DatasetSchema, structuredClone(rawData));

function expectFacilityIssue(data: Dataset, id: string, message: string) {
  const result = v.safeParse(DatasetSchema, data);
  expect(result.success).toBe(false);
  if (!result.success)
    expect(result.issues.some((issue) => issue.message.includes(id) && issue.message.includes(message))).toBe(true);
}

describe('公開データ', () => {
  it.each([
    ['2026-11-01', '2026-12-31', true],
    ['2027-03-01', '2026-12-31', true],
    ['2026-10-01', '2026-12-31', false],
    ['2027-04-01', '2026-12-31', false],
    ['2026-01-01', '2026-12-31', false],
    ['2026-12-01', '2027-01-01', true],
    ['2027-02-01', '2026-12-31', true],
  ])('入所日%sと取得日%sの間隔の検証結果は%s', (admissionDate, snapshot, valid) => {
    const data = dataset();
    Object.assign(data.wards[0], { admissionDate, snapshot, vacancyFor: Number(admissionDate.slice(5, 7)) + '月1日入所用' });
    const result = v.safeParse(DatasetSchema, data);
    expect(result.success).toBe(valid);
    if (!valid && !result.success)
      expect(result.issues.some((issue) => issue.message.includes(data.wards[0].id) && issue.message.includes('取得月'))).toBe(
        true,
      );
  });

  it.each([undefined, '', '2026/11/01', '2026-1-01', '2026-13-01', '2026-00-01', '2026-11-02', '2026-02-30', '2026-02-29'])(
    '入所日は必須で、実在するISO形式の月初日だけを受け付ける (%s)',
    (admissionDate) => {
      expect(v.safeParse(WardSchema, { ...rawData.wards[0], admissionDate }).success).toBe(false);
    },
  );

  it.each(['2026-11-01', '2027-01-01', '2028-02-01'])('実在する入所日の月と表示が一致すれば受け付ける (%s)', (admissionDate) => {
    const vacancyFor = String(Number(admissionDate.slice(5, 7))) + '月1日入所用';
    expect(v.safeParse(WardSchema, { ...rawData.wards[0], admissionDate, vacancyFor }).success).toBe(true);
  });

  it.each(['12月1日入所用', '入所月不明'])('入所日と一致しない入所月の表示を拒否する (%s)', (vacancyFor) => {
    expect(v.safeParse(WardSchema, { ...rawData.wards[0], admissionDate: '2026-11-01', vacancyFor }).success).toBe(false);
  });

  it.each(['', '2026/10/22', '2026-1-22', '2026-13-22', '2026-02-30', '2026-02-29'])(
    'スナップショットの取得日をISO日付として検証する (%s)',
    (date) => {
      const data = dataset();
      data.citySnapshot = date;
      expect(v.safeParse(DatasetSchema, data).success).toBe(false);
      const wardData = dataset();
      wardData.wards[0].snapshot = date;
      expect(v.safeParse(DatasetSchema, wardData).success).toBe(false);
    },
  );
  it('コミット済みのfacilities.jsonがスキーマと不変条件を満たす', () => {
    const result = v.safeParse(DatasetSchema, rawData);
    expect(result.success, result.issues ? v.summarize(result.issues) : undefined).toBe(true);
  });

  it('共有枠と該当年齢の人数が違う場合は施設ID付きで拒否する', () => {
    const data = dataset();
    const f = data.facilities.find((facility) => facility.sharedVacancy);
    if (!f?.sharedVacancy) throw new Error('共有枠のある施設が必要です');
    f.vacancies[f.sharedVacancy.ages[0]] = f.sharedVacancy.count + 1;
    expectFacilityIssue(data, f.id, '共有枠の人数が該当年齢の空き人数と一致しません');
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
    expectFacilityIssue(data, f.id, '共有枠の年齢は0〜5歳の異なる2件以上が必要です');
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
    expectFacilityIssue(data, data.facilities[0].id, '空き人数は0〜5歳の6件が必要です');
  });

  it.each([
    [-1, '人数は0以上'],
    [1.5, '人数は整数'],
  ] as const)('空き人数%sを拒否する', (n, message) => {
    const f = dataset().facilities[0];
    f.vacancies[0] = n;
    expect(() => v.parse(FacilitySchema, f)).toThrow(message);
  });

  it('同じ施設IDを複数回掲載できない', () => {
    const data = dataset();
    data.facilities.push(structuredClone(data.facilities[0]));
    expectFacilityIssue(data, data.facilities[0].id, '施設IDが重複しています');
  });

  it.each(['missing', 'name'])('区の対応が不正な場合は施設ID付きで拒否する (%s)', (mode) => {
    const data = dataset();
    const f = data.facilities[0];
    if (mode === 'missing') f.ward = 'unknown';
    else f.wardName = '存在しない区';
    expectFacilityIssue(data, f.id, mode === 'missing' ? '区がwardsに存在しません' : '区名がwardsと一致しません');
  });

  it('施設のない区を区ID付きで拒否する', () => {
    const data = dataset();
    const ward = data.wards[0];
    data.facilities = data.facilities.filter((f) => f.ward !== ward.id);
    const result = v.safeParse(DatasetSchema, data);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(
        result.issues.some((issue) => issue.message.includes(ward.id) && issue.message.includes('施設が1件もありません')),
      ).toBe(true);
  });

  it('重複した区を区ID付きで拒否する', () => {
    const data = dataset();
    data.wards.push(structuredClone(data.wards[0]));
    const result = v.safeParse(DatasetSchema, data);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(
        result.issues.some((issue) => issue.message.includes(data.wards[0].id) && issue.message.includes('区IDが重複しています')),
      ).toBe(true);
  });

  it.each(
    FacilityTypeSchema.options.map(
      (type) => [type, LICENSING_BY_FACILITY_TYPE[type] === 'licensed' ? 'unlicensed' : 'licensed'] as const,
    ),
  )('施設種別%sと認可区分%sの不整合を施設ID付きで拒否する', (facilityType, licensing) => {
    const data = dataset();
    const f = data.facilities[0];
    f.facilityType = facilityType;
    f.licensing = licensing;
    expectFacilityIssue(data, f.id, '施設種別に対応する認可区分と一致しません');
  });

  it('大阪市外の施設座標を施設ID付きで拒否する', () => {
    const data = dataset();
    data.facilities[0].lat = 35;
    expectFacilityIssue(data, data.facilities[0].id, '座標が大阪市内の範囲外です');
  });

  it.each([
    [{ total: 7, byAge: [1, 1, 1, 1, 1, 1, 1] }, '定員内訳は0〜5歳の最大6件です'],
    [{ total: 20, byAge: [5, 5] }, '定員内訳の合計が総定員と一致しません'],
  ])('定員内訳の不正な値を拒否する (%j)', (capacity, message) => {
    const f = dataset().facilities[0];
    const result = v.safeParse(FacilitySchema, { ...f, capacity });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.some((issue) => issue.message.includes(message))).toBe(true);
  });

  it.each([
    ['javascript:alert(1)', 'URLはhttpまたはhttpsが必要です'],
    ['ftp://example.com/file', 'URLはhttpまたはhttpsが必要です'],
    ['URLではない文字列', '有効なURLが必要です'],
    ['https://', '有効なURLが必要です'],
  ])('HTTP以外や不正なURLを拒否する (%s)', (website, message) => {
    const result = v.safeParse(FacilitySchema, { ...dataset().facilities[0], website });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.some((issue) => issue.message.includes(message))).toBe(true);
  });
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
