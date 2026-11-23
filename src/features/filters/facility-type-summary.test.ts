import { describe, expect, it } from 'vitest';
import { formatFacilityTypeSummary } from './facility-type-summary';

describe('施設種別の選択状態の要約表示', () => {
  it('未選択なら未選択を返す', () => {
    expect(formatFacilityTypeSummary([])).toBe('未選択');
  });

  it('全種別選択ならすべてを返す', () => {
    expect(formatFacilityTypeSummary(['nursery', 'kodomoen', 'community', 'kigyo'])).toBe('すべて');
  });

  it('1種別なら短い名称を返す', () => {
    expect(formatFacilityTypeSummary(['community'])).toBe('地域型保育');
    expect(formatFacilityTypeSummary(['kigyo'])).toBe('企業主導型');
  });

  it('2種別なら定義順で中黒区切りにする', () => {
    expect(formatFacilityTypeSummary(['kigyo', 'nursery'])).toBe('保育所・企業主導型');
  });

  it('3種別なら先頭の名称と残りの種別数を返す', () => {
    expect(formatFacilityTypeSummary(['kigyo', 'community', 'kodomoen'])).toBe('認定こども園 ほか2種');
  });
});
