import { describe, expect, it } from 'vitest';
import { controlBottomOffsetOf, hiddenBottomOf } from './viewport-padding';

describe('hiddenBottomOf', () => {
  it('画面内に収まっている地図では 0 を返す', () => {
    expect(hiddenBottomOf({ top: 110, bottom: 800, height: 690 }, 800)).toBe(0);
    expect(hiddenBottomOf({ top: 48, bottom: 915, height: 867 }, 915)).toBe(0);
  });

  it('画面下にはみ出した分だけを返し、スクロールに応じて 0 まで減る', () => {
    expect(hiddenBottomOf({ top: 258, bottom: 1125, height: 867 }, 915)).toBe(210);
    expect(hiddenBottomOf({ top: 153, bottom: 1020, height: 867 }, 915)).toBe(105);
    expect(hiddenBottomOf({ top: 48, bottom: 915, height: 867 }, 915)).toBe(0);
  });

  it('古い iPhone のような低い画面でも見えている領域分だけ下パディングを返す', () => {
    expect(hiddenBottomOf({ top: 278, bottom: 780, height: 502 }, 550)).toBe(230);
  });

  it('極端に狭い画面では最小可視高さを残すよう上限をかける', () => {
    expect(hiddenBottomOf({ top: 245, bottom: 447, height: 202 }, 250)).toBe(82);
    expect(hiddenBottomOf({ top: 245, bottom: 327, height: 82 }, 130)).toBe(0);
  });
});

describe('controlBottomOffsetOf', () => {
  it('地図が画面外に押し出されているときは 0 を返す', () => {
    expect(controlBottomOffsetOf({ top: 245, bottom: 327, height: 82 }, 130)).toBe(0);
  });

  it('見えている地図の下端に合わせてクレジットを持ち上げる', () => {
    expect(controlBottomOffsetOf({ top: 258, bottom: 1125, height: 867 }, 915)).toBe(210);
    expect(controlBottomOffsetOf({ top: 48, bottom: 915, height: 867 }, 915)).toBe(0);
  });
});
