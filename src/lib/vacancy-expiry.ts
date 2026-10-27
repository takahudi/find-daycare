import type { Facility, Ward } from '../schema';

export function vacancyExpiryTime(admissionDate: string): number {
  // UTC の月初や端末のタイムゾーンでは、日本時間の入所日と最大1日ずれる。
  return Date.parse(admissionDate + 'T00:00:00+09:00');
}

export function isVacancyExpired(admissionDate: string, now: Date): boolean {
  return now.getTime() >= vacancyExpiryTime(admissionDate);
}

export function nextExpiryDelay(wards: readonly Pick<Ward, 'admissionDate'>[], now: Date): number | null {
  const next = Math.min(...wards.map((ward) => vacancyExpiryTime(ward.admissionDate)).filter((time) => time > now.getTime()));
  if (!Number.isFinite(next)) return null;
  // 25日以上先の入所日は setTimeout の上限を超えて即時実行されるため分割する。
  return Math.min(next - now.getTime(), 2_147_483_647);
}

export function isFacilityVacancyExpired(
  facility: Pick<Facility, 'facilityType' | 'ward'>,
  expiredWardIds: ReadonlySet<string>,
): boolean {
  return facility.facilityType !== 'kigyo' && expiredWardIds.has(facility.ward);
}

export function vacancyExpiryMessage(
  expiredWards: readonly Pick<Ward, 'name' | 'admissionDate' | 'vacancyFor'>[],
  wardCount: number,
): string | null {
  if (expiredWards.length === 0) return null;
  const groups = new Map<string, { label: string; names: string[] }>();
  for (const ward of expiredWards) {
    const key = ward.admissionDate.slice(0, 7);
    const group = groups.get(key) ?? { label: ward.vacancyFor, names: [] };
    group.names.push(ward.name);
    groups.set(key, group);
  }
  let message: string;
  if (groups.size === 1) {
    const subject =
      expiredWards.length === wardCount ? '空き情報' : expiredWards.map((ward) => ward.name).join('・') + 'の空き情報';
    message = subject + '（企業主導型を除く）は' + expiredWards[0].vacancyFor + 'のもので、入所日を過ぎています。';
  } else {
    message =
      [...groups.values()].map((group) => group.names.join('・') + 'は' + group.label).join('、') +
      'の空き情報（企業主導型を除く）で、入所日を過ぎています。';
  }
  return message + '最新の空き状況は各区役所に確認してください。';
}
