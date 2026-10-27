import { useQueryStates } from 'nuqs';
import type { FacilityType } from '../../schema';
import { FACILITY_TYPES } from '../../lib/facility-labels';
import { AGES } from '../../lib/vacancy';
import type { SortKey } from '../../lib/list-facilities';
import { createFilterParsers } from './query-state';

export const toggleSelection = <T>(list: T[], value: T, values: readonly T[]) =>
  values.filter((candidate) => (candidate === value ? !list.includes(candidate) : list.includes(candidate)));

export function useFilters(initial: { wardIds: string[]; sort: SortKey }) {
  const [query, setQuery] = useQueryStates(createFilterParsers(initial.wardIds));
  const sort = query.sort === 'distance' && initial.sort !== 'distance' ? 'vacancy' : (query.sort ?? initial.sort);
  return {
    ages: query.age,
    wardIds: query.ward,
    facilityTypes: query.type,
    onlyOpen: query.open,
    sort,
    toggleAge: (age: number) => void setQuery((current) => ({ age: toggleSelection(current.age, age, AGES) })),
    toggleWard: (wardId: string) =>
      void setQuery((current) => ({ ward: toggleSelection(current.ward, wardId, initial.wardIds) })),
    toggleFacilityType: (facilityType: FacilityType) =>
      void setQuery((current) => ({ type: toggleSelection(current.type, facilityType, FACILITY_TYPES) })),
    setOnlyOpen: (value: boolean) => void setQuery({ open: value }),
    followDefaultSort: () => void setQuery({ sort: null }),
    setSort: (value: SortKey) => void setQuery({ sort: value === initial.sort ? null : value }),
  };
}
