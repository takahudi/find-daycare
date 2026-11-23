import type { Ward } from '../../schema';

export function formatWardSummary(wards: readonly Pick<Ward, 'id' | 'name'>[], wardIds: readonly string[]): string {
  const selected = wards.filter((w) => wardIds.includes(w.id));
  if (selected.length === 0) return '未選択';
  if (selected.length === wards.length) return `すべて（${wards.length}区）`;
  if (selected.length === 1) return selected[0].name;
  if (selected.length === 2) return `${selected[0].name}・${selected[1].name}`;
  return `${selected[0].name} ほか${selected.length - 1}区`;
}
