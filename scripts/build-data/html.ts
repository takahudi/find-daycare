import type { TableCell } from './types.ts';
import { HEADER_NAME } from './text.ts';

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
export const isHeaderRow = (cells: TableCell[]) => cells.some((c) => HEADER_NAME.test(c.text));
