import { useState } from 'react';
import type { FacilityType } from '../../schema';
import { FACILITY_TYPES } from '../../lib/facility-labels';
import type { SortKey } from '../../lib/list-facilities';

const toggle = <T>(list: T[], value: T) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

export function useFilters(initial: { wardIds: string[]; sort: SortKey }) {
  const [ages, setAges] = useState<number[]>([]);
  const [wardIds, setWardIds] = useState<string[]>(initial.wardIds);
  const [facilityTypes, setFacilityTypes] = useState<FacilityType[]>([...FACILITY_TYPES]);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [sort, setSort] = useState<SortKey>(initial.sort);
  return {
    ages,
    wardIds,
    facilityTypes,
    onlyOpen,
    sort,
    toggleAge: (age: number) => setAges((current) => toggle(current, age).sort((a, b) => a - b)),
    toggleWard: (wardId: string) => setWardIds((current) => toggle(current, wardId)),
    toggleFacilityType: (facilityType: FacilityType) => setFacilityTypes((current) => toggle(current, facilityType)),
    setOnlyOpen: (value: boolean) => setOnlyOpen(value),
    setSort: (value: SortKey) => setSort(value),
  };
}
