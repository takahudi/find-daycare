import { useEffect, useState } from 'react';
import { createParser, useQueryState } from 'nuqs';

export function parseAsFacilityId(facilityIds: readonly string[]) {
  const idSet = new Set(facilityIds);
  return createParser({
    parse: (value) => (idSet.has(value) ? value : null),
    serialize: (value) => value,
  });
}

export function useSelectedFacility(facilityIds: readonly string[], visible: readonly { id: string }[]) {
  const [queryId, setSelectedId] = useQueryState('facility', parseAsFacilityId(facilityIds));
  const [clearInitialSelection] = useState(() => queryId !== null && !visible.some((facility) => facility.id === queryId));
  const selectedId = queryId;
  useEffect(() => {
    if (clearInitialSelection) {
      void setSelectedId(null);
    }
  }, [clearInitialSelection, setSelectedId]);
  return { selectedId, setSelectedId: (id: string | null) => void setSelectedId(id) };
}
