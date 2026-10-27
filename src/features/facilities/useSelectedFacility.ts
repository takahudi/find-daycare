import { useEffect, useState } from 'react';
import { createParser, useQueryState } from 'nuqs';

export function parseAsFacilityId(facilityIds: string[]) {
  return createParser({
    parse: (value) => (facilityIds.includes(value) ? value : null),
    serialize: (value) => value,
  });
}

export function useSelectedFacility(facilityIds: string[], visibleIds: string[]) {
  const [queryId, setSelectedId] = useQueryState('facility', parseAsFacilityId(facilityIds));
  const [clearInitialSelection] = useState(() => queryId !== null && !visibleIds.includes(queryId));
  const selectedId = queryId;
  useEffect(() => {
    if (clearInitialSelection) {
      void setSelectedId(null);
    }
  }, [clearInitialSelection, setSelectedId]);
  return { selectedId, setSelectedId: (id: string | null) => void setSelectedId(id) };
}
