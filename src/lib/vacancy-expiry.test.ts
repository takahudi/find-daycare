import { describe, expect, it } from 'vitest';
import { isVacancyExpired, nextExpiryDelay, isFacilityVacancyExpired, vacancyExpiryMessage } from './vacancy-expiry';

describe('入所月を過ぎた空き情報', () => {
  it.each([
    ['2026-10-27T12:00:00+09:00', false],
    ['2026-10-31T23:59:00+09:00', false],
    ['2026-10-31T14:59:59.999Z', false],
    ['2026-11-01T00:00:00+09:00', true],
    ['2026-10-31T15:00:00.000Z', true],
    ['2026-10-31T08:00:00-07:00', true],
    ['2026-11-02T00:00:00+09:00', true],
  ])('11月入所用は%sに期限切れ=%sになる', (now, expected) => {
    expect(isVacancyExpired('2026-11-01', new Date(now))).toBe(expected);
  });

  it('年をまたいでも区ごとの入所日で判定する', () => {
    const now = new Date('2026-12-31T15:00:00Z');
    expect(isVacancyExpired('2027-01-01', now)).toBe(true);
    expect(isVacancyExpired('2027-02-01', now)).toBe(false);
  });
});

describe('次の入所日までの待ち時間', () => {
  const wards = [{ admissionDate: '2026-11-01' }, { admissionDate: '2026-12-01' }];
  it('区がなければ次の更新はない', () => expect(nextExpiryDelay([], new Date('2026-10-01T00:00:00+09:00'))).toBeNull());
  it('すべて過去なら次の更新はない', () => expect(nextExpiryDelay(wards, new Date('2026-12-01T00:00:00+09:00'))).toBeNull());
  it('未来のうち最も近い入所日を選ぶ', () =>
    expect(nextExpiryDelay([...wards].reverse(), new Date('2026-10-31T23:59:00+09:00'))).toBe(60_000));
  it('ちょうど入所日なら次の区の入所日を選ぶ', () =>
    expect(nextExpiryDelay(wards, new Date('2026-11-01T00:00:00+09:00'))).toBe(2_147_483_647));
  it.each([2_147_483_646, 2_147_483_647, 2_147_483_648, 31 * 86_400_000])('入所日まで%sミリ秒なら上限以内に収まる', (delay) => {
    const now = new Date(Date.parse('2026-11-01T00:00:00+09:00') - delay);
    expect(nextExpiryDelay([wards[0]], now)).toBe(Math.min(delay, 2_147_483_647));
  });
  it('境界の1ミリ秒前は1ミリ秒だけ待つ', () => expect(nextExpiryDelay([wards[0]], new Date('2026-10-31T14:59:59.999Z'))).toBe(1));
  it('境界ちょうどに最後の区が期限切れなら次の更新はない', () =>
    expect(nextExpiryDelay([wards[0]], new Date('2026-10-31T15:00:00Z'))).toBeNull());
});

describe('施設の空き情報の期限', () => {
  it.each(['nursery', 'kodomoen', 'community', 'kigyo'] as const)('%sは区が期限切れでも企業主導型だけ対象外', (facilityType) => {
    expect(isFacilityVacancyExpired({ facilityType, ward: 'kita' }, new Set(['kita']))).toBe(facilityType !== 'kigyo');
    expect(isFacilityVacancyExpired({ facilityType, ward: 'abeno' }, new Set(['kita']))).toBe(false);
    expect(isFacilityVacancyExpired({ facilityType, ward: 'kita' }, new Set())).toBe(false);
  });
});

describe('期限切れの区の警告文', () => {
  const kita = { name: '北区', admissionDate: '2026-11-01', vacancyFor: '11月1日入所用' };
  const abeno = { ...kita, name: '阿倍野区' };
  const suffix = '最新の空き状況は各区役所に確認してください。';
  it('期限切れの区がなければ警告はない', () => expect(vacancyExpiryMessage([], 24)).toBeNull());
  it('全区が同じ入所日なら区名を省く', () =>
    expect(vacancyExpiryMessage([kita, abeno], 2)).toBe(
      '空き情報（企業主導型を除く）は11月1日入所用のもので、入所日を過ぎています。' + suffix,
    ));
  it('一部の区なら区名を並べる', () =>
    expect(vacancyExpiryMessage([kita, abeno], 24)).toBe(
      '北区・阿倍野区の空き情報（企業主導型を除く）は11月1日入所用のもので、入所日を過ぎています。' + suffix,
    ));
  it('入所月が違う区は月ごとにまとめる', () =>
    expect(
      vacancyExpiryMessage(
        [kita, { ...abeno, admissionDate: '2026-12-01', vacancyFor: '12月1日入所用' }, { ...kita, name: '中央区' }],
        24,
      ),
    ).toBe(
      '北区・中央区は11月1日入所用、阿倍野区は12月1日入所用の空き情報（企業主導型を除く）で、入所日を過ぎています。' + suffix,
    ));
  it('全区でも入所月が違えば対応する区名を残す', () =>
    expect(vacancyExpiryMessage([kita, { ...abeno, admissionDate: '2026-12-01', vacancyFor: '12月1日入所用' }], 2)).toBe(
      '北区は11月1日入所用、阿倍野区は12月1日入所用の空き情報（企業主導型を除く）で、入所日を過ぎています。' + suffix,
    ));
});
