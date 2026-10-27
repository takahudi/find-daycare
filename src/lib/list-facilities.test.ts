import { describe, expect, it } from 'vitest';
import type { Facility, Home } from '../schema';
import { listFacilities, type ListingOptions } from './list-facilities';

const facility = (id: string, overrides: Partial<Facility> = {}): Facility => ({
  id,
  ward: 'kita',
  wardName: '北区',
  name: id,
  kana: id,
  facilityType: 'nursery',
  licensing: 'licensed',
  detailType: null,
  ownership: null,
  operator: null,
  postalCode: null,
  address: '大阪市北区',
  phone: '06-0000-0000',
  lat: 34.7,
  lng: 135.5,
  vacancies: [0, 0, 0, 0, 0, 0],
  sharedVacancy: null,
  capacity: null,
  hours: null,
  services: [],
  approvedOn: null,
  note: null,
  website: null,
  websiteLabel: null,
  infoPdfUrl: null,
  infoPdfLabel: null,
  ...overrides,
});
const facilities = [
  facility('b', {
    name: 'い施設',
    kana: 'いしせつ',
    vacancies: [0, 2, 2, null, null, null],
    sharedVacancy: { ages: [1, 2], count: 2 },
  }),
  facility('c', {
    name: 'う施設',
    kana: 'うしせつ',
    ward: 'chuo',
    wardName: '中央区',
    lat: 34.701,
    vacancies: [3, 0, 0, 0, 0, 0],
  }),
  facility('a', {
    name: 'あ施設',
    kana: '',
    facilityType: 'kigyo',
    licensing: 'unlicensed',
    vacancies: [null, 0, 0, null, null, null],
  }),
  facility('d', { name: 'え施設', kana: 'えしせつ', lat: 34.702, vacancies: [1, 1, 0, 0, 0, 0] }),
];
const sortingFacilities = [
  facility('a', { name: 'あ施設', kana: 'えしせつ', lat: 34.703, vacancies: [2, 0, 0, 0, 0, 0] }),
  facility('b', { name: 'い施設', kana: 'いしせつ', lat: 34.702, vacancies: [2, 0, 0, 0, 0, 0] }),
  facility('c', {
    name: 'う施設',
    kana: '',
    facilityType: 'kigyo',
    licensing: 'unlicensed',
    lat: 34.701,
    vacancies: [3, 0, 0, 0, 0, 0],
  }),
  facility('d', { name: 'え施設', kana: 'おしせつ', lat: 34.7, vacancies: [1, 0, 0, 0, 0, 0] }),
];
const defaults: ListingOptions = {
  ages: [],
  wardIds: ['kita', 'chuo'],
  facilityTypes: ['nursery', 'kodomoen', 'community', 'kigyo'],
  onlyOpen: false,
  sort: 'vacancy',
};
const home: Home = { lat: 34.7, lng: 135.5, label: '自宅' };
const list = (filters: Partial<ListingOptions> = {}, origin: Home | null = null) =>
  listFacilities(facilities, { ...defaults, ...filters }, origin);
const ids = (result: ReturnType<typeof list>) => result.visible.map((f) => f.id);

describe('listFacilities', () => {
  it('共有枠を重複させず空き人数の降順に並べ、同数ならふりがな順にする', () => {
    expect(ids(list())).toEqual(['c', 'b', 'd', 'a']);
    expect(list().vacancyOf(facilities[0])).toBe(2);
  });
  it('空き人数が同じなら入力順によらず名前順に並べる', () => {
    expect(ids(listFacilities(sortingFacilities, defaults, null))).toEqual(['c', 'b', 'a', 'd']);
  });
  it('選んだ区と施設種別を両方満たす施設を返す', () => {
    expect(ids(list({ wardIds: ['kita'], facilityTypes: ['nursery'] }))).toEqual(['b', 'd']);
  });
  it('選んだクラス年齢のいずれかを受け入れる施設を空き0人でも返す', () => {
    expect(ids(list({ ages: [0] }))).toEqual(['c', 'd', 'b']);
    expect(ids(list({ ages: [0, 1] }))).toEqual(['c', 'b', 'd', 'a']);
  });
  it('空きのみでは選んだクラス年齢の空き人数で絞り込む', () => {
    expect(ids(list({ ages: [0], onlyOpen: true }))).toEqual(['c', 'd']);
    expect(ids(list({ ages: [1, 2], onlyOpen: true }))).toEqual(['b', 'd']);
  });
  it('クラス年齢未選択の空きのみでは全クラスの空きを使う', () => {
    expect(ids(list({ onlyOpen: true }))).toEqual(['c', 'b', 'd']);
  });
  it('ふりがながない施設は施設名を使って名前順に並べる', () => {
    expect(ids(listFacilities(sortingFacilities, { ...defaults, sort: 'name' }, null))).toEqual(['b', 'c', 'a', 'd']);
  });
  it('自宅からの直線距離順に並べ、同距離なら名前順にする', () => {
    const result = listFacilities(sortingFacilities, { ...defaults, sort: 'distance' }, home);
    expect(ids(result)).toEqual(['d', 'c', 'b', 'a']);
    expect(result.distanceOf(sortingFacilities[3])).toBe(0);
    expect(result.distanceOf(sortingFacilities[2])).toBeCloseTo(111.195, 2);
    expect(result.distanceOf(sortingFacilities[1])).toBeCloseTo(222.39, 2);
    const tied = [sortingFacilities[0], { ...sortingFacilities[1], lat: sortingFacilities[0].lat }];
    expect(ids(listFacilities(tied, { ...defaults, sort: 'distance' }, home))).toEqual(['b', 'a']);
  });
  it('自宅未指定の距離はnullで距離順は名前順になる', () => {
    const result = list({ sort: 'distance' });
    expect(ids(result)).toEqual(['a', 'b', 'c', 'd']);
    expect(result.distanceOf(facilities[1])).toBeNull();
  });
  it('区や施設種別の選択が空なら空の一覧を返す', () => {
    expect(ids(list({ wardIds: [] }))).toEqual([]);
    expect(ids(list({ facilityTypes: [] }))).toEqual([]);
    expect(listFacilities([], defaults, home).visible).toEqual([]);
  });
  it('入力の施設と絞り込み条件を変更しない', () => {
    const before = structuredClone({ facilities, defaults, home });
    listFacilities(facilities, defaults, home);
    expect({ facilities, defaults, home }).toEqual(before);
  });
});
