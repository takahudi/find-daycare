import type { CellValue } from './types.ts';
import XLSX from 'xlsx';
import { cell, HEADER_NAME } from './text.ts';

/**
 * xlsx の表（東成区・北区）を、見出し行（施設名の列がある行）と、その下の行ごとのセルに直す。
 * 施設名の列が空の行（表の下の注記など）は除く。末尾の空欄も見出しの列数まで空文字で埋める
 * blankIsZero: 空文字のセルを「空欄」とする（東淀川区は空文字のセルが空きなし、セルなしが受入れなし。照合で0として読む）
 */
export function xlsxTable(file: string, blankIsZero = false) {
  const wb = XLSX.readFile(file);
  const all = XLSX.utils.sheet_to_json<CellValue[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
  const at = all.findIndex((r) => r.some((c) => typeof c === 'string' && HEADER_NAME.test(cell(c))));
  if (at < 0) throw new Error(`${file}: 見出し行（施設名）が見つからない`);
  const headers = all[at].map((c) => (c == null ? '' : cell(c)));
  const nameCol = headers.findIndex((h) => HEADER_NAME.test(h));
  const rows = all
    .slice(at + 1)
    .filter((r) => typeof r[nameCol] === 'string' && r[nameCol].trim() && !/^[※●]/.test(r[nameCol].trim()))
    .map((r) =>
      headers.map((_, k) => ({
        span: 1,
        html: String(r[k] ?? ''),
        text: r[k] == null ? '' : r[k] === '' && blankIsZero && k !== nameCol ? '空欄' : cell(r[k]),
      })),
    );
  return { headers, nameCol, rows };
}
