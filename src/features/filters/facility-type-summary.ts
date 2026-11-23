import type { FacilityType } from '../../schema';
import { FACILITY_TYPES } from '../../lib/facility-labels';

const SHORT_LABELS: Record<FacilityType, string> = {
  nursery: '保育所',
  kodomoen: '認定こども園',
  community: '地域型保育',
  kigyo: '企業主導型',
};

export function formatFacilityTypeSummary(facilityTypes: readonly FacilityType[]): string {
  const selected = FACILITY_TYPES.filter((type) => facilityTypes.includes(type));
  if (selected.length === 0) return '未選択';
  if (selected.length === FACILITY_TYPES.length) return 'すべて';
  if (selected.length === 1) return SHORT_LABELS[selected[0]];
  if (selected.length === 2) return `${SHORT_LABELS[selected[0]]}・${SHORT_LABELS[selected[1]]}`;
  return `${SHORT_LABELS[selected[0]]} ほか${selected.length - 1}種`;
}
