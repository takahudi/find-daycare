import type { FacilityType, Licensing } from '../schema';

export const FACILITY_TYPE_LABELS: Record<FacilityType, { label: string; filterLabel: string }> = {
  nursery: { label: '保育所', filterLabel: '保育所' },
  kodomoen: { label: '認定こども園', filterLabel: '認定こども園' },
  community: { label: '地域型保育事業', filterLabel: '地域型保育（0〜2歳）' },
  kigyo: { label: '企業主導型', filterLabel: '企業主導型' },
};

export const LICENSING_LABELS: Record<Licensing, { label: string; detailLabel: string }> = {
  licensed: { label: '認可', detailLabel: '認可保育施設' },
  unlicensed: { label: '認可外', detailLabel: '認可外保育施設' },
};
