import { describe, expect, it } from 'vitest';
import { formatHomeLabel } from './home-label';

describe('自宅住所の短縮表示', () => {
  it('大阪府大阪市で始まる住所は区名以降だけを返す', () => {
    expect(formatHomeLabel('大阪府大阪市東成区中道四丁目')).toBe('東成区中道四丁目');
  });

  it('大阪市で始まる住所は区名以降だけを返す', () => {
    expect(formatHomeLabel('大阪市北区中之島1-3-20')).toBe('北区中之島1-3-20');
  });

  it('大阪市そのものや市外の住所や現在地はそのまま返す', () => {
    expect(formatHomeLabel('大阪市')).toBe('大阪市');
    expect(formatHomeLabel('大阪府大阪市')).toBe('大阪府大阪市');
    expect(formatHomeLabel('大阪府堺市堺区')).toBe('大阪府堺市堺区');
    expect(formatHomeLabel('現在地')).toBe('現在地');
  });
});
