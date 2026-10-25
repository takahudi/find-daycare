import type { TableCell } from '../data-types.ts';

export const decode = (s: string) =>
  s
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();

/** 表の行ごとのセル（見出しセル th も含めて並び順のまま）。施設名を th に置く区がある（浪速区） */
export const tableRows = (tableHtml: string): TableCell[][] =>
  [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(([, tr]) =>
    [...tr.matchAll(/<t[hd]([^>]*)>([\s\S]*?)<\/t[hd]>/g)].map(([, attrs, html]) => ({
      span: Number(attrs.match(/colspan="(\d+)"/)?.[1] ?? 1),
      html,
      text: decode(html),
    })),
  );
// 見出しの施設名の列は「施設名」「保育事業所名」「施設・事業名」（城東区）「名称」（東住吉区）など
export const HEADER_NAME = /施設名|事業所名|施設・事業名|^名称$/;
export const isHeaderRow = (cells: TableCell[]) => cells.some((c) => HEADER_NAME.test(c.text));
