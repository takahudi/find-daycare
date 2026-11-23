import { describe, expect, it } from 'vitest';
import { formatWardSummary } from './ward-summary';

const wards = [
  { id: 'chuo', name: '中央区' },
  { id: 'higashinari', name: '東成区' },
  { id: 'tennoji', name: '天王寺区' },
  { id: 'kita', name: '北区' },
];

describe('区の選択状態の要約表示', () => {
  it('未選択なら未選択を返す', () => {
    expect(formatWardSummary(wards, [])).toBe('未選択');
  });

  it('全区選択なら区数つきのすべてを返す', () => {
    expect(formatWardSummary(wards, ['chuo', 'higashinari', 'tennoji', 'kita'])).toBe('すべて（4区）');
  });

  it('1区なら区名をそのまま返す', () => {
    expect(formatWardSummary(wards, ['higashinari'])).toBe('東成区');
  });

  it('2区なら区の並び順で中黒区切りにする', () => {
    expect(formatWardSummary(wards, ['kita', 'higashinari'])).toBe('東成区・北区');
  });

  it('3区以上なら先頭の区名と残りの区数を返す', () => {
    expect(formatWardSummary(wards, ['kita', 'tennoji', 'higashinari'])).toBe('東成区 ほか2区');
  });
});
