import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import rawData from '../data/facilities.json';
import { DatasetSchema, type Dataset } from '../schema';
import { summarizeDataset } from './dataset-summary';

const data = v.parse(DatasetSchema, rawData);
const withWards = (count: number): Dataset => ({ ...data, wards: data.wards.slice(0, count) });

describe('summarizeDataset', () => {
  it.each([1, 2, 3, 4])('%i区なら区名をすべて見出しに並べる', (count) => {
    const subset = withWards(count);
    const names = subset.wards.map((ward) => ward.name);
    expect(summarizeDataset(subset)).toMatchObject({ wardNames: names, title: `大阪市 ${names.join('・')}` });
  });

  it.each(Array.from({ length: 19 }, (_, index) => index + 5))('%i区なら区数を見出しに表示する', (count) => {
    expect(summarizeDataset(withWards(count)).title).toBe(`大阪市 ${count}区`);
  });

  it('24区なら大阪市だけを見出しに表示する', () => {
    expect(summarizeDataset(withWards(24)).title).toBe('大阪市');
  });

  it('全区の時点と入所月が揃えば1つのラベルにまとめる', () => {
    const shared = {
      ...data,
      wards: data.wards.map((ward) => ({ ...ward, vacancyAsOf: '10月1日現在', vacancyFor: '11月入所用' })),
    };
    expect(summarizeDataset(shared).asOfLabels).toEqual(['10月1日現在（11月入所用）']);
  });

  it('時点または入所月が違えば区の順にラベルを残す', () => {
    const wards = [
      { ...data.wards[0], vacancyAsOf: '10月1日現在', vacancyFor: '11月入所用' },
      { ...data.wards[1], vacancyAsOf: '10月2日現在', vacancyFor: '11月入所用' },
      { ...data.wards[2], vacancyAsOf: '10月1日現在', vacancyFor: '12月入所用' },
      { ...data.wards[3], vacancyAsOf: '10月1日現在', vacancyFor: '11月入所用' },
    ];
    expect(summarizeDataset({ ...data, wards }).asOfLabels).toEqual([
      '10月1日現在（11月入所用）',
      '10月2日現在（11月入所用）',
      '10月1日現在（12月入所用）',
    ]);
  });

  it('企業主導型は多数の時点を基本にして例外の区名と時点を添える', () => {
    const labels = ['9月1日現在', '10月1日現在', '10月1日現在', '9月1日現在', '10月1日現在', '8月1日現在'];
    const wards = data.wards.slice(0, labels.length).map((ward, index) => ({ ...ward, kigyoVacancyAsOf: labels[index] }));
    expect(summarizeDataset({ ...data, wards }).kigyoAsOfText).toBe(
      `10月1日現在（${wards[0].name}・${wards[3].name}は9月1日現在、${wards[5].name}は8月1日現在）`,
    );
  });

  it('企業主導型の時点が揃えば例外を付けない', () => {
    const wards = data.wards.map((ward) => ({ ...ward, kigyoVacancyAsOf: '10月1日現在' }));
    expect(summarizeDataset({ ...data, wards }).kigyoAsOfText).toBe('10月1日現在');
  });

  it('企業主導型の時点がなければ表示しない', () => {
    const wards = data.wards.map((ward) => ({ ...ward, kigyoVacancyAsOf: null }));
    expect(summarizeDataset({ ...data, wards }).kigyoAsOfText).toBeNull();
  });
});
