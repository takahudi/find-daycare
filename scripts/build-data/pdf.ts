import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pageTextItems } from '../pdf-text.ts';
import type { PositionedText } from '../pdf-text.ts';
import type { TableCell } from './types.ts';

/**
 * PDFの表（生野区・鶴見区・旭区の企業主導型の空き情報、旭区の空き情報）を、HTMLの表と同じ「行ごとのセル」に直す。
 * 見出し行（施設名・所在地・連絡先・0歳〜5歳）の位置から列の境界（隣り合う見出しの中間）を決め、
 * 同じ高さの文字を同じ行として各列に振り分ける。空欄の年齢は空文字のセル（= 受入れなし）になる
 * section: 1ページに複数の表がある資料（住之江区の空き情報は認可施設と企業主導型）で、この見出しより下の表だけを読む
 */
export async function pdfTableRows(
  file: string,
  section: string | null = null,
): Promise<{ headers: string[] | undefined; rows: TableCell[][] }> {
  const doc = await getDocument({ data: new Uint8Array(await readFile(file)), verbosity: 0 }).promise;
  const rows: TableCell[][] = [];
  let headers: string[] | undefined;
  for (let p = 1; p <= doc.numPages; p++) {
    const items = (await pageTextItems(await doc.getPage(p)))
      .filter((i) => i.str.trim())
      .map((i): PositionedText => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5] }));
    const marker = section && items.find((i) => i.s === section);
    if (section && !marker) continue;
    const below = (i: PositionedText) => !marker || i.y < marker.y;
    const ageHeads = items.filter((i) => below(i) && /^[0-5]\s*歳/.test(i.s.normalize('NFKC'))).sort((a, b) => a.x - b.x);
    // 施設名の見出しがない表（旭区の空き情報）は、年齢の見出しの1列ぶん左に施設名の列の見出しがあるものとする
    const header =
      items.filter((i) => below(i) && /^(?:保育)?施設名$/.test(i.s)).sort((a, b) => b.y - a.y)[0] ??
      (ageHeads.length === 6 ? { s: '施設名', x: 2 * ageHeads[0].x - ageHeads[1].x, y: ageHeads[0].y } : null);
    if (!header) continue;
    // 年齢の見出しが施設名の見出しより1行上にある表（旭区の企業主導型）も、同じ見出し行として扱う
    const cols = [
      ...new Set([
        header,
        ...items.filter((i) => Math.abs(i.y - header.y) <= 3),
        ...ageHeads.filter((i) => Math.abs(i.y - header.y) <= 15),
      ]),
    ].sort((a, b) => a.x - b.x);
    const used = new Set(cols);
    // 年齢の見出しを「0／歳／児」と縦に1文字ずつ書く区（鶴見区）は、すぐ上下の「0」「児」もつないで「0歳児」にする
    const headerText = (c: PositionedText) => {
      const parts =
        c.s === '歳' ? items.filter((i) => Math.abs(i.x - c.x) <= 6 && Math.abs(i.y - c.y) <= 15).sort((a, b) => b.y - a.y) : [c];
      for (const i of parts) used.add(i);
      return parts
        .map((i) => i.s)
        .join('')
        .normalize('NFKC')
        .replace(/\s+/g, '');
    };
    headers ??= cols.map(headerText);
    const bounds = cols.slice(1).map((c, k) => (cols[k].x + c.x) / 2);
    const columnOf = (i: PositionedText) => bounds.filter((b) => i.x > b).length;
    const top = Math.min(...cols.map((c) => c.y)) - 3;
    const lines: { y: number; items: PositionedText[] }[] = [];
    for (const i of items.filter((item) => item.y < top && !used.has(item)).sort((a, b) => b.y - a.y || a.x - b.x)) {
      const line = lines.find((l) => Math.abs(l.y - i.y) <= 3);
      if (line) line.items.push(i);
      else lines.push({ y: i.y, items: [i] });
    }
    // 所在地・連絡先を2〜3行に分けて書く区（鶴見区・旭区）は、施設名の列が空の行を、上下13pt以内にある施設名の行に含める
    const named = lines.filter((l) => l.items.some((i) => columnOf(i) === 0));
    for (const l of lines.filter((line) => !named.includes(line))) {
      const near = named.filter((n) => Math.abs(n.y - l.y) <= 13).sort((a, b) => Math.abs(a.y - l.y) - Math.abs(b.y - l.y))[0];
      if (near) near.items.push(...l.items);
    }
    for (const line of named) {
      const texts = cols.map((): string[] => []);
      for (const i of line.items.sort((a, b) => b.y - a.y || a.x - b.x)) texts[columnOf(i)].push(i.s);
      // 表の下の注記など、年齢の列が空の行は表の行ではない
      if (!texts.slice(-6).some((t) => t.length)) continue;
      rows.push(
        texts.map((t) => {
          const text = t.join(' ').normalize('NFKC');
          return { span: 1, html: text, text };
        }),
      );
    }
  }
  return { headers, rows };
}
