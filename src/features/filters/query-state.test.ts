import { describe, expect, it } from 'vitest';
import { createSerializer, createLoader } from 'nuqs/server';
import { createFilterParsers } from './query-state';
import { toggleSelection } from './useFilters';

const parsers = createFilterParsers(['kita', 'abeno']);
const load = createLoader(parsers);
const serialize = createSerializer(parsers);

describe('絞り込みの URL', () => {
  it('不正な値を捨て、既定の状態を返す', () => {
    expect(load('?ward=unknown&age=-1,6,1.0,01&tek=1&type=other&open=true&sort=other')).toEqual({
      ward: ['kita', 'abeno'],
      age: [],
      type: ['nursery', 'kodomoen', 'community', 'kigyo'],
      open: false,
      sort: null,
    });
  });
  it('既知の値を決まった順に重複なく読む', () => {
    expect(load('?ward=abeno,unknown,kita,abeno&age=5,0,3,0,9&type=kigyo,nursery,other&open=1&sort=name')).toEqual({
      ward: ['kita', 'abeno'],
      age: [0, 3, 5],
      type: ['nursery', 'kigyo'],
      open: true,
      sort: 'name',
    });
  });
  it('選択順によらず同じ URL を書く', () => {
    expect(
      serialize({
        age: toggleSelection([5], 0, [0, 1, 2, 3, 4, 5]),
        type: toggleSelection(['kigyo'], 'nursery', ['nursery', 'kodomoen', 'community', 'kigyo']),
      }),
    ).toBe('?age=0,5&type=nursery,kigyo');
  });
  it('全区・全種別・年齢未指定・空きのみオフを省略する', () => {
    expect(
      serialize({
        ward: ['kita', 'abeno'],
        age: [],
        type: ['nursery', 'kodomoen', 'community', 'kigyo'],
        open: false,
        sort: null,
      }),
    ).toBe('');
  });
  it('区や種別の選択が0件の状態も再現できる', () => {
    expect(serialize({ ward: [], type: [] })).toBe('?ward=&type=');
    expect(load('?ward=&type=')).toMatchObject({ ward: [], type: [] });
    expect(load('?ward=,&type=,,')).toMatchObject({ ward: [], type: [] });
  });
});
