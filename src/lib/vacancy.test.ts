import { describe, expect, it } from 'vitest';
import type { Facility } from '../schema';
import { acceptsAny, vacancyCount } from './vacancy';

const facility = (vacancies: (number | null)[], sharedVacancy: Facility['sharedVacancy'] = null): Facility => ({
  id: 'chuo-1',
  ward: 'chuo',
  wardName: '中央区',
  name: 'テスト保育園',
  kana: 'てすとほいくえん',
  facilityType: 'nursery',
  licensing: 'licensed',
  detailType: null,
  ownership: null,
  operator: null,
  postalCode: null,
  address: '大阪市中央区本町1丁目',
  phone: '06-0000-0000',
  lat: 34.683,
  lng: 135.503,
  vacancies,
  sharedVacancy,
  capacity: null,
  hours: null,
  services: [],
  approvedOn: null,
  note: null,
  website: null,
  websiteLabel: null,
  infoPdfUrl: null,
  infoPdfLabel: null,
});

describe('vacancyCount', () => {
  it('選んだクラス年齢の空き人数を合計し、受入れ対象外の年齢は0人として数える', () => {
    const f = facility([null, 2, 0, 3, 1, 1]);
    expect(vacancyCount(f, [1, 3])).toBe(5);
    expect(vacancyCount(f, [0])).toBe(0);
  });

  it('クラス年齢を選んでいなければ全年齢を合計する', () => {
    expect(vacancyCount(facility([null, 2, 0, 3, 1, 1]), [])).toBe(7);
  });

  it('共有枠は複数のクラス年齢にまたがっても1回だけ数える', () => {
    // 1・2歳あわせて1人の共有枠は、vacancies の1歳・2歳の両方に1が入っている
    const f = facility([0, 1, 1, 2, 0, 0], { ages: [1, 2], count: 1 });
    expect(vacancyCount(f, [])).toBe(3);
    expect(vacancyCount(f, [1, 2])).toBe(1);
    expect(vacancyCount(f, [2])).toBe(1);
    expect(vacancyCount(f, [2, 3])).toBe(3);
    expect(vacancyCount(f, [0])).toBe(0);
  });
});

describe('acceptsAny', () => {
  const f = facility([null, 0, 2, null, null, null]);

  it('クラス年齢を選んでいなければ常に対象にする', () => {
    expect(acceptsAny(f, [])).toBe(true);
  });

  it('選んだクラス年齢のどれかを受け入れていれば、空きが0人でも対象にする', () => {
    expect(acceptsAny(f, [1])).toBe(true);
    expect(acceptsAny(f, [0, 2])).toBe(true);
  });

  it('選んだクラス年齢をどれも受け入れていなければ対象外にする', () => {
    expect(acceptsAny(f, [0, 3])).toBe(false);
  });
});
