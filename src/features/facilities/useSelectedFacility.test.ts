import { expect, it } from 'vitest';
import { parseAsFacilityId } from './useSelectedFacility';

it('データにある施設 ID だけを復元する', () => {
  const parser = parseAsFacilityId(['chuo-53101', 'kita-1']);
  expect(parser.parse('chuo-53101')).toBe('chuo-53101');
  expect(parser.serialize('kita-1')).toBe('kita-1');
  expect(parser.parse('unknown')).toBeNull();
  expect(parser.parse('')).toBeNull();
});
