import { createParser, parseAsStringLiteral } from 'nuqs';
import { FACILITY_TYPES } from '../../lib/facility-labels';
import { SORT_KEYS } from '../../lib/list-facilities';
import { AGES } from '../../lib/vacancy';

export function parseAsOrderedSelection<T extends string | number>(values: readonly T[]) {
  return createParser({
    parse: (query) => {
      const tokens = query.split(',').filter(Boolean);
      if (tokens.length === 0) return [];
      const selection = values.filter((value) => tokens.includes(String(value)));
      return selection.length ? selection : null;
    },
    serialize: (selection) => selection.join(','),
    eq: (a, b) => a.length === b.length && a.every((value, index) => value === b[index]),
  });
}

export function createFilterParsers(wardIds: string[]) {
  return {
    ward: parseAsOrderedSelection(wardIds).withDefault(wardIds),
    age: parseAsOrderedSelection<number>(AGES).withDefault([]),
    type: parseAsOrderedSelection(FACILITY_TYPES).withDefault([...FACILITY_TYPES]),
    open: createParser<boolean>({
      parse: (query) => (query === '1' ? true : null),
      serialize: (value) => (value ? '1' : '0'),
    }).withDefault(false),
    sort: parseAsStringLiteral(SORT_KEYS),
  };
}
