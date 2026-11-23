// 大阪市「地域の児童が利用できる認可外保育施設一覧（詳細）」PDFの1ページ分のテキストから、施設ごとの項目を読む。
import type { TextItem } from 'pdfjs-dist/types/src/display/api.js';
import type { KigyoDetail } from './data-schema.ts';
import type { PositionedText } from './pdf-text.ts';

type BlockField = 'name' | 'type' | 'address';
type KigyoBlock = Omit<KigyoDetail, BlockField | 'page'> & Partial<Pick<KigyoDetail, BlockField>>;

const TIME = /^\d{1,2}:\d{2}$/;
const DATE = /^(平成|令和)\S*年\S*月\S*日$/;
const HOURS_LABELS: [keyof KigyoBlock['hours'], RegExp][] = [
  ['weekday', /^平 日/],
  ['saturday', /^土 曜/],
  ['holiday', /^日 ・ 祝/],
];

/** 値ブロックの先頭に付く区の見出し（例: "(05中央区)"） */
const isWardTag = (t: string) => /^\(\d{2}\S+区\)$/.test(t);

export function toPositionedTexts(items: TextItem[]): PositionedText[] {
  return items.map((i) => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5] })).filter((i) => i.s);
}

/**
 * 1施設分（ページの上段または下段）のトークン列から各項目を読む。
 * 項目は「ラベルの直後の値」という隣接関係だけで判定するので、段内でのテキストの出現順には依存しない。
 */
function parseBlock(items: PositionedText[]): KigyoBlock {
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
  // 施設名と日付は、テキストの出現順ではなくラベルとの位置で読む。
  // 出現順で読むと、施設名には「証明書あり」が、事業開始日には同じ段の「証明書発行日」の日付が入ることがある
  const sameRow = (a: PositionedText, b: PositionedText) => Math.abs(a.y - b.y) <= 2;
  const dateBeside = (label: RegExp) => {
    const at = items.find((i) => label.test(i.s));
    return at && items.find((i) => sameRow(i, at) && DATE.test(i.s))?.s;
  };
  const typeLabel = items.find((_, j) => tokens[j] === '施' && tokens[j + 1] === '設' && tokens[j + 2] === '種');
  if (typeLabel) {
    // 施設名は区の見出しと「施設種別」の行の間の1行（同じ行の複数の文字列に分かれていることがある）
    const nameRow = items.filter((i) => i.y > typeLabel.y + 5 && i.y < items[0].y - 5).sort((a, b) => a.x - b.x);
    if (nameRow.length) block.name = nameRow.map((i) => i.s).join(' ');
  }
  const startedOn = dateBeside(/^始\s*日$/);
  if (startedOn) block.startedOn = startedOn;
  const certifiedOn = dateBeside(/^証\s*明\s*書\s*発\s*行\s*日$/);
  if (certifiedOn) block.certifiedOn = certifiedOn;
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
export function parsePage(items: PositionedText[]): KigyoBlock[] {
  const tags = items.filter((i) => isWardTag(i.s)).sort((a, b) => b.y - a.y);
  // トークンが属する段 = そのトークンより上にある見出しのうち最も近いもの（見出しは段の最上部にある）
  const regionOf = (item: PositionedText) => tags.filter((t) => t.y + 5 >= item.y).at(-1);
  return tags.map((tag) => parseBlock([tag, ...items.filter((i) => i !== tag && regionOf(i) === tag)]));
}
