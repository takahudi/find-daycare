// 大阪市「地域の児童が利用できる認可外保育施設一覧（詳細）」PDFから、
// 対象区の企業主導型保育事業の開所時間・定員・設置者などを抽出する。
// 出力: data/<区>/kigyo-details.json （電話番号 → 抽出結果）
// Usage: node scripts/extract-kigyo-details.ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validateJson } from './json.ts';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { WARDS } from './wards.ts';
import { pageTextItems } from './pdf-text.ts';
import type { KigyoDetail } from './data-schema.ts';

type BlockField = 'name' | 'type' | 'address';
type KigyoBlock = Omit<KigyoDetail, BlockField | 'page'> & Partial<Pick<KigyoDetail, BlockField>>;

type Token = { s: string; x: number; y: number };

const PDF = path.resolve('sources/city/ninkagai_detail.pdf');

const TIME = /^\d{1,2}:\d{2}$/;
const HOURS_LABELS: [keyof KigyoBlock['hours'], RegExp][] = [
  ['weekday', /^平 日/],
  ['saturday', /^土 曜/],
  ['holiday', /^日 ・ 祝/],
];

/** 値ブロックの先頭に付く区の見出し（例: "(05中央区)"） */
const isWardTag = (t: string) => /^\(\d{2}\S+区\)$/.test(t);

/**
 * 1施設分（ページの上段または下段）のトークン列から各項目を読む。
 * 項目は「ラベルの直後の値」という隣接関係だけで判定するので、段内でのテキストの出現順には依存しない。
 */
function parseBlock(items: Token[]): KigyoBlock {
  const tokens = items.map((i) => i.s);
  // 電話番号の欄が空欄の施設（西淀川区の西大阪保育園）もあるので、番号の形のときだけ電話番号とする
  const block: KigyoBlock = {
    wardTag: tokens[0],
    phone: /^0\d+-\d+-\d+$/.test(tokens[1]) ? tokens[1] : null,
    hours: {},
    capacity: null,
    monthlyUpTo: null,
    freeOfCharge: null,
  };
  // 施設名と事業開始日は、テキストの出現順ではなくラベルとの位置で読む。
  // 出現順で読むと、施設名には「証明書あり」が、事業開始日には同じ段の「証明書発行日」の日付が入ることがある
  const sameRow = (a: Token, b: Token) => Math.abs(a.y - b.y) <= 2;
  const typeLabel = items.find((_, j) => tokens[j] === '施' && tokens[j + 1] === '設' && tokens[j + 2] === '種');
  if (typeLabel) {
    // 施設名は区の見出しと「施設種別」の行の間の1行（同じ行の複数の文字列に分かれていることがある）
    const nameRow = items.filter((i) => i.y > typeLabel.y + 5 && i.y < items[0].y - 5).sort((a, b) => a.x - b.x);
    if (nameRow.length) block.name = nameRow.map((i) => i.s).join(' ');
  }
  const startLabel = items.find((i) => /^始\s*日$/.test(i.s));
  const started = startLabel && items.find((i) => sameRow(i, startLabel) && /^(平成|令和)\S*年\S*月\S*日$/.test(i.s));
  if (started) block.startedOn = started.s;
  for (let j = 0; j < tokens.length; j++) {
    const t = tokens[j];
    const label = HOURS_LABELS.find(([, re]) => re.test(t))?.[0];
    if (label) {
      // 「8:00 / ～ 当日 / 19:00」または「18:00 / ～ 翌 / 3:00」。時間がなければ「～」のみ
      const [open, sep, close] = tokens.slice(j + 1, j + 4);
      if (TIME.test(open) && TIME.test(close)) {
        block.hours[label] = `${open.padStart(5, '0')}〜${sep.includes('翌') ? '翌' : ''}${close.padStart(5, '0')}`;
      }
    } else if (t === '月極保育' && /^～ ./.test(tokens[j + 1])) {
      block.monthlyUpTo = tokens[j + 1].replace(/^～\s*/, '');
    } else if (/^\d+名$/.test(t)) {
      block.capacity = Number(t.replace('名', ''));
    } else if (/^国の無償化対象/.test(t)) {
      block.freeOfCharge = t === '国の無償化対象';
    } else if (t === '別' && tokens[j - 1] === '種' && !block.type) {
      block.type = tokens[j + 1];
    } else if (/^\d{3}-\d{4}$/.test(t) && !block.postalCode) {
      block.postalCode = t;
      block.address = tokens[j + 1];
    } else if (t === '者' && tokens[j - 1] === '置' && !block.operator) {
      // 設置者名は「株式会社」「〇〇」のように分かれていることがあるので、次の見出し（開所時間等）までつなげる
      const parts: string[] = [];
      // 段内の出現順によっては設置者名の後に施設名（直後が「施 設 種 別」）が続くので、そこでも止める
      // ページ番号のフッター（「163 ページ」）が続くこともある（西成区のエミリア保育園）
      const stop = (k: number) =>
        tokens[k] === '開' || (tokens[k + 1] === '施' && tokens[k + 2] === '設') || /^\d+ ページ$/.test(tokens[k]);
      for (let k = j + 1; k < tokens.length && !stop(k); k++) {
        parts.push(tokens[k]);
      }
      block.operator = parts.join(' ').normalize('NFKC').replace(/\s+/g, ' ').trim();
    }
  }
  return block;
}

/**
 * 1ページに上下2施設が載るが、テキストの出現順は上下の施設で入り組むことがある。
 * 各施設の区見出し（"(05中央区)" など）の縦位置でページを段に分け、段ごとに読む。
 */
function parsePage(items: Token[]) {
  const tags = items.filter((i) => isWardTag(i.s)).sort((a, b) => b.y - a.y);
  // トークンが属する段 = そのトークンより上にある見出しのうち最も近いもの（見出しは段の最上部にある）
  const regionOf = (item: Token) => tags.filter((t) => t.y + 5 >= item.y).at(-1);
  return tags.map((tag) => parseBlock([tag, ...items.filter((i) => i !== tag && regionOf(i) === tag)]));
}

const doc = await getDocument({ data: new Uint8Array(await readFile(PDF)), verbosity: 0 }).promise;
const outputs: { ward: (typeof WARDS)[number]; out: Record<string, KigyoDetail> }[] = WARDS.map((ward) => ({ ward, out: {} }));
const outByTag = new Map(outputs.map(({ ward, out }) => [ward.ninkagaiTag, out]));
for (let p = 1; p <= doc.numPages; p++) {
  const items = await pageTextItems(await doc.getPage(p));
  const tokens = items.map((i): Token => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5] })).filter((i) => i.s);
  if (!tokens.some((t) => outByTag.has(t.s))) continue;
  for (const block of parsePage(tokens)) {
    if (!block.name) throw new Error(`page ${p}: ${block.phone} の施設名が読めない`);
    const out = outByTag.get(block.wardTag);
    if (block.type !== '企業主導型保育事業' || !out) continue;
    // build-data.ts は所在地でも対応付けるので、所在地のない施設は書き出さない
    if (!block.address) throw new Error(`page ${p}: ${block.phone} の所在地が読めない`);
    const detail: KigyoDetail = { ...block, name: block.name, type: block.type, address: block.address, page: p };
    // キーは電話番号（ない施設は施設名。build-data.ts は電話番号のほか所在地でも対応付ける）
    out[block.phone ?? `(電話番号なし)${block.name}`] = detail;
  }
}

for (const { out } of outputs) validateJson('kigyo-details.json', out);
for (const { ward, out } of outputs) {
  await mkdir(path.resolve('data', ward.id), { recursive: true });
  await writeFile(path.resolve('data', ward.id, 'kigyo-details.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`== ${ward.name}`);
  for (const d of Object.values(out)) {
    console.log(
      [
        d.phone,
        d.name,
        d.operator,
        d.address,
        `平日=${d.hours.weekday ?? '-'}`,
        `土=${d.hours.saturday ?? '-'}`,
        `日祝=${d.hours.holiday ?? '-'}`,
        `定員=${d.capacity ?? '-'}`,
        `月極〜${d.monthlyUpTo}`,
        `p${d.page}`,
      ].join(' | '),
    );
  }
}
