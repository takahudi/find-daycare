import { describe, expect, it } from 'vitest';
import { getVacancyDates } from './ward.ts';

describe('区の空き情報の時点と入所日', () => {
  it.each([
    [10, 11, '2026-10-27', 2026, '2026-11-01'],
    [12, 1, '2026-12-20', 2026, '2027-01-01'],
    [12, 1, '2027-01-10', 2026, '2027-01-01'],
    [11, 12, '2027-01-10', 2026, '2026-12-01'],
    [1, 2, '2026-12-20', 2027, '2027-02-01'],
    [1, 2, '2026-12-31', 2027, '2027-02-01'],
    [12, 1, '2027-01-01', 2026, '2027-01-01'],
    [1, 2, '2027-01-01', 2027, '2027-02-01'],
    [1, 1, '2026-01-10', 2026, '2026-01-01'],
    [2, 3, '2028-02-29', 2028, '2028-03-01'],
  ])('%s月現在の%s月入所用を取得日%sから求める', (asOfMonth, admissionMonth, snapshot, asOfYear, admissionDate) => {
    expect(getVacancyDates(asOfMonth, admissionMonth, snapshot)).toEqual({
      vacancyAsOf: `令和${asOfYear - 2018}年${asOfMonth}月1日現在`,
      vacancyFor: `${admissionMonth}月1日入所用`,
      admissionDate,
    });
  });
});
