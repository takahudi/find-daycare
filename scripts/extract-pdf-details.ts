// 大阪市「保育施設等一覧」（区別）の各施設基本情報PDFから、
// 認可定員・開園時間・施設URL・認可年月日・特別保育・ふりがなを抽出する。
// 出力: data/<区>/pdf-details.json （ファイル名 → 抽出結果）
// Usage: node scripts/extract-pdf-details.ts
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validateJson } from './json.ts';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { WARDS } from './wards.ts';
import { pageTextItems } from './pdf-text.ts';
import type { PositionedText } from './pdf-text.ts';
import type { PdfDetail } from './data-schema.ts';

const SERVICES = [
  '延長保育',
  '一時預かり',
  '障がい児保育',
  '休日保育',
  '病児対応型',
  '病後児対応型',
  '体調不良児対応型',
  '地域子育て支援事業',
];
const MARKS = new Set(['〇', '○', '◎', '●', '■', '☑', '✓', 'レ']);
const TIME = /^(\d{1,2})時(\d{2})分$/;

async function loadPages(file: string) {
  const doc = await getDocument({ data: new Uint8Array(await readFile(file)), verbosity: 0 }).promise;
  const pages: PositionedText[][] = [];
  for (let p = 1; p <= Math.min(doc.numPages, 2); p++) {
    const items = await pageTextItems(await doc.getPage(p));
    pages.push(
      items
        .filter((it) => it.str.trim())
        .map((it): PositionedText => ({ s: it.str.trim(), x: it.transform[4], y: it.transform[5] })),
    );
  }
  return pages;
}

const sameRow = (a: PositionedText, b: PositionedText, tol = 3) => Math.abs(a.y - b.y) <= tol;
const toHalf = (s: string) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

function capacity(items: PositionedText[]): (NonNullable<PdfDetail['capacity']> & { note?: string }) | null {
  const labels = items.filter((i) => i.s === '認可定員').sort((a, b) => a.x - b.x || b.y - a.y);
  const label = labels[0];
  if (!label) return null;
  // 公立保育所の様式（特定教育・保育施設基本情報）は「6人」のように単位付きで、合計欄がない
  const numericRight = (rowY: number, from = label.x, to = label.x + 320) =>
    items
      .filter((i) => Math.abs(i.y - rowY) <= 3 && i.x > from && i.x < to && /^\d+人?$/.test(toHalf(i.s)))
      .sort((a, b) => a.x - b.x)
      .map((i) => Number(toHalf(i.s).replace('人', '')));
  const perAgeOnly = (rowY: number) =>
    items.some((i) => Math.abs(i.y - rowY) <= 3 && i.x > label.x && /^\d+人$/.test(toHalf(i.s)));

  // 幼保連携型の様式: 「１号（3〜5歳・小計）」と「２号・３号（0〜5歳・小計）」の認可定員欄が同じ行に並ぶ。
  // 年齢別は両方を合算し、内訳は注記に残す
  const second = labels.find((l) => l !== label && sameRow(l, label) && l.x > label.x);
  if (second) {
    const first = numericRight(label.y, label.x, second.x);
    const rest = numericRight(second.y, second.x, second.x + 220);
    if (first.length !== 4 || rest.length !== 7) return null;
    const byAge = rest.slice(0, 6).map((n, age) => n + (age >= 3 ? first[age - 3] : 0));
    return { total: first[3] + rest[6], byAge, note: `認可定員は1号${first[3]}人＋2号・3号${rest[6]}人。` };
  }
  let rowY = label.y;
  let nums = numericRight(rowY);
  if (nums.length < 2) {
    // 地域型・公立の様式: 見出し行の下に値の行がある
    const ys = [...new Set(items.filter((i) => i.y < label.y && i.y > label.y - 40).map((i) => Math.round(i.y)))].sort(
      (a, b) => b - a,
    );
    for (const y of ys) {
      nums = numericRight(y);
      rowY = y;
      if (nums.length >= 2) break;
    }
  }
  if (nums.length < 2) return null;
  if (perAgeOnly(rowY)) {
    // この様式は5歳児の欄が右端（項目名から約400pt）まであるので範囲を広げて読み直す
    const byAge = numericRight(rowY, label.x, label.x + 450);
    if (byAge.length !== 6) return null;
    const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
    // 幼稚園型認定こども園（公立）は「（１号）」「（２号）」の2行に分かれているので合算し、内訳を注記する
    const secondRow = numericRight(rowY - 19, label.x, label.x + 450);
    const hasTypeRows = items.some((i) => /^（[１1]号）$/.test(i.s)) && items.some((i) => /^（[２2]号）$/.test(i.s));
    if (hasTypeRows && secondRow.length === 6) {
      return {
        total: sum(byAge) + sum(secondRow),
        byAge: byAge.map((n, k) => n + secondRow[k]),
        note: `認可定員は1号${sum(byAge)}人＋2号${sum(secondRow)}人。`,
      };
    }
    return { total: sum(byAge), byAge };
  }
  return { total: nums[nums.length - 1], byAge: nums.slice(0, -1) };
}

function hours(items: PositionedText[], labelText: string) {
  // 認定こども園の様式は「●１号 開園時間等」（教育）と「●２・３号 開園時間等」（保育）が左右に並ぶ。保育の側を読む
  const nursery = items.find(
    (i) => /^●[２2]・[３3]号$/.test(i.s) && items.some((h) => h.s === '開園時間等' && sameRow(h, i) && h.x > i.x),
  );
  const labels = items
    .filter((i) => (i.s === labelText || i.s === `${labelText}日`) && (!nursery || (i.x > nursery.x && i.y < nursery.y)))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  for (const label of labels) {
    const times = items
      .filter((i) => sameRow(i, label) && i.x > label.x && i.x < label.x + 140 && TIME.test(i.s))
      .sort((a, b) => a.x - b.x)
      .map((i) => i.s.replace(TIME, (_: string, h: string, m: string) => `${h.padStart(2, '0')}:${m}`));
    if (times.length >= 2) return `${times[0]}〜${times[1]}`;
  }
  return null;
}

/**
 * 公立保育所の様式: 「月曜日 ～ 土曜日」見出しの下に「最大開所時間 ７：３０ ～ １９：３０」（月〜土で共通）。
 * 夜間保育所を併設する施設（北区の大淀保育所）は「７：３０（８：００）」のように括弧内に夜間の時間を書く
 */
function maxOpeningHours(items: PositionedText[]) {
  const header = items.find((i) => /^月曜日\s*～\s*土曜日$/.test(i.s));
  const label = items.find((i) => i.s === '最大開所時間');
  if (!header || !label) return null;
  const TIME_CELL = /^(\d{1,2}:\d{2})(?:\((\d{1,2}:\d{2})\))?$/;
  const cells = items
    .filter((i) => sameRow(i, label) && i.x > label.x)
    .map((i) => ({ x: i.x, m: toHalf(i.s).replace(/：/g, ':').replace(/（/g, '(').replace(/）/g, ')').match(TIME_CELL) }))
    .filter((c): c is { x: number; m: RegExpMatchArray } => Boolean(c.m))
    .sort((a, b) => a.x - b.x);
  if (cells.length !== 2) return null;
  const range = (k: number) =>
    cells.every((c) => c.m[k]) ? `${cells[0].m[k].padStart(5, '0')}〜${cells[1].m[k].padStart(5, '0')}` : null;
  return { day: range(1), night: range(2) };
}

function services(items: PositionedText[]) {
  const result: string[] = [];
  for (const name of SERVICES) {
    // 印は項目名の左（従来の様式）か、項目名の下の「実施状況」行（公立保育所の様式）
    const marked = items
      .filter((i) => i.s === name)
      .some((label) =>
        items.some(
          (i) =>
            MARKS.has(i.s) &&
            ((sameRow(i, label, 4) && i.x < label.x && i.x > label.x - 25) ||
              (label.y - i.y > 8 && label.y - i.y < 25 && i.x >= label.x && i.x < label.x + name.length * 10)),
        ),
      );
    if (marked) result.push(name);
  }
  return result;
}

function url(allItems: PositionedText[]) {
  const text = allItems.map((i) => i.s);
  const hit = text.find((s) => /https?:\/\/|www\./i.test(s) && !s.includes('@'));
  if (!hit) return null;
  const u = hit.match(/(https?:\/\/[^\s　]+|www\.[^\s　]+)/i)?.[1];
  return u ? (u.startsWith('http') ? u : `https://${u}`) : null;
}

// 空き情報CSVのふりがなは旧名称・仮称のまま残っているものがあるため、PDFの「ふりがな」欄を正とする
function kana(items: PositionedText[]) {
  const label = items.filter((i) => i.s === 'ふりがな').sort((a, b) => b.y - a.y)[0];
  if (!label) return null;
  const parts = items
    .filter((i) => sameRow(i, label) && i.x > label.x && i.x < label.x + 330 && /^[\p{Script=Hiragana}ー・\s　]+$/u.test(i.s))
    .sort((a, b) => a.x - b.x)
    .map((i) => i.s);
  return parts.length ? parts.join('') : null;
}

const ERA_START: Record<string, number> = { 昭和: 1925, 平成: 1988, 令和: 2018 };

function approvedOn(allItems: PositionedText[]) {
  const hit = allItems.find((i) => /^\d{4}年\d{1,2}月\d{1,2}日$/.test(i.s));
  if (hit) return hit.s;
  // 公立保育所の様式は和暦（例: 昭和43年3月1日）
  const era = allItems.map((i) => toHalf(i.s).match(/^(昭和|平成|令和)(\d+|元)年(\d{1,2})月(\d{1,2})日$/)).find(Boolean);
  return era ? `${ERA_START[era[1]] + (era[2] === '元' ? 1 : Number(era[2]))}年${era[3]}月${era[4]}日` : null;
}

const outputs: { ward: (typeof WARDS)[number]; out: Record<string, PdfDetail> }[] = WARDS.map((ward) => ({ ward, out: {} }));
for (const { ward, out } of outputs) {
  const pdfDir = path.resolve('sources', ward.id, 'facility-pdfs');
  const files = (await readdir(pdfDir)).filter((f) => f.endsWith('.pdf')).sort();
  for (const f of files) {
    const pages = await loadPages(path.join(pdfDir, f));
    const all = pages.flat();
    const hourItems = pages[1] ?? pages[0];
    const c = capacity(pages[0]);
    const monToSat = maxOpeningHours(hourItems);
    out[f] = {
      kana: kana(pages[0]),
      capacity: c?.total ? { total: c.total, byAge: c.byAge } : null,
      ...(c?.note && { note: c.note }),
      weekday: hours(hourItems, '平日') ?? monToSat?.day ?? null,
      saturday: hours(hourItems, '土曜') ?? monToSat?.day ?? null,
      ...(monToSat?.night && { nightHours: monToSat.night }),
      services: services(pages[0]),
      url: url(all),
      approvedOn: approvedOn(pages[0]),
    };
  }
}

for (const { out } of outputs) validateJson('pdf-details.json', out);
for (const { ward, out } of outputs) {
  await mkdir(path.resolve('data', ward.id), { recursive: true });
  await writeFile(path.resolve('data', ward.id, 'pdf-details.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`== ${ward.name}`);
  for (const [f, d] of Object.entries(out)) {
    console.log(
      [
        f.padEnd(36),
        d.kana ?? '-',
        `定員=${d.capacity?.total ?? '-'}(${d.capacity?.byAge.join('/') ?? ''})`,
        `平日=${d.weekday ?? '-'}`,
        `土=${d.saturday ?? '-'}`,
        d.services.join('・') || '-',
        d.url ?? '-',
        d.approvedOn ?? '-',
      ].join(' | '),
    );
  }
}
