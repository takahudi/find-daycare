import type { CellValue } from './types.ts';
import type { Facility } from '../../src/types.ts';

// 見出しの施設名の列は「施設名」「保育事業所名」「施設・事業名」（城東区）「名称」（東住吉区）など
export const HEADER_NAME = /施設名|事業所名|施設・事業名|^名称$/;

export const normName = (s: string) =>
  s
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/^(?:幼保連携型|幼稚園型|保育所型)?認定こども園/, '')
    .replace(/[（(]夜間[)）]/, '');
export const normPhone = (s: string) => s.normalize('NFKC').replace(/\D/g, '').replace(/^06/, '');
export const cell = (v: CellValue) => String(v).normalize('NFKC').replace(/\s+/g, ' ').trim();

export const vacancy = (v: CellValue): number | null => {
  // 「2名」（大正区の企業主導型）のように単位を付けた値もある
  const t = String(v ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/^(\d+)\s*[名人]$/, '$1');
  // 「※2」のような注記参照は、その施設では受け付けていない（他区の本園で保育など）年齢。注記は ward-details.json に転記する
  // 「無し」（西区）・「×」（城東区）はその年齢のクラスがない（受入れをしていない）
  if (t === '' || /^[-－―ー‐]$/.test(t) || /^※\d*$/.test(t) || t === '無し' || t === '×') return null;
  const n = Number(t);
  if (!Number.isFinite(n)) throw new Error(`unexpected vacancy value: ${v}`);
  return n;
};

/** 「1～2歳児で合計4人」「３歳～5歳で２名」のように複数の年齢で共有する空きの表記 */
export const parseShared = (v: CellValue): Facility['sharedVacancy'] => {
  const m = String(v ?? '')
    .normalize('NFKC')
    .trim()
    .match(/^(\d)歳?児?[～~〜-](\d)歳児?で(?:合計)?(\d+)[人名]$/);
  if (!m) return null;
  const [from, to, count] = m.slice(1).map(Number);
  return { ages: Array.from({ length: to - from + 1 }, (_, k) => from + k), count };
};

/** 区の表の施設名に付く「（注1）」などの注記参照や「【認定こども園】」（福島区）を外す */
export const stripNoteRef = (s: string) => s.replace(/[（(]注\d*[)）]/g, '').replace(/【[^】]*】/g, '');
