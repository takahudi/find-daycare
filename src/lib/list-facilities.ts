import type { Facility, FacilityType, Home } from '../schema';
import { distanceMeters } from './geo';
import { acceptsAny, vacancyCount } from './vacancy';

export type SortKey = 'distance' | 'vacancy' | 'name';

export interface ListingOptions {
  ages: number[];
  wardIds: string[];
  facilityTypes: FacilityType[];
  onlyOpen: boolean;
  sort: SortKey;
}

export function listFacilities(facilities: Facility[], filters: ListingOptions, home: Home | null) {
  const { ages, wardIds, facilityTypes, onlyOpen, sort } = filters;
  const distances = new Map(facilities.map((f) => [f.id, home ? distanceMeters(home, f) : null]));
  const distanceFor = (f: Facility) => distances.get(f.id) ?? null;
  const vacancyFor = (f: Facility) => vacancyCount(f, ages);
  const filtered = facilities.filter(
    (f) =>
      wardIds.includes(f.ward) &&
      facilityTypes.includes(f.facilityType) &&
      acceptsAny(f, ages) &&
      (!onlyOpen || vacancyFor(f) > 0),
  );
  // 企業主導型はふりがなの一次情報がないので施設名で並べる
  const byName = (a: Facility, b: Facility) => (a.kana || a.name).localeCompare(b.kana || b.name, 'ja');
  const comparators: Record<SortKey, (a: Facility, b: Facility) => number> = {
    distance: (a, b) => {
      const distanceA = distanceFor(a) ?? 0;
      const distanceB = distanceFor(b) ?? 0;
      return distanceA - distanceB || byName(a, b);
    },
    vacancy: (a, b) => vacancyFor(b) - vacancyFor(a) || byName(a, b),
    name: byName,
  };
  filtered.sort(comparators[sort]);
  return { visible: filtered, distanceOf: distanceFor, vacancyOf: vacancyFor };
}
