// 一次情報（大阪市・各区役所の公開データ）から、アプリが読む src/data/facilities.json を生成する。
// 対象の区と取得元は scripts/wards.mjs を参照。
//
// 入力（sources/ 配下）
//   sukusukudata.csv            大阪市「保育施設等 空き情報マップ」のデータ（全市。緯度経度・年齢別空き人数）
//   <区>/list.xlsx              大阪市「保育施設等一覧（区別）」（施設種別・設置運営・郵便番号・運営法人）
//   <区>/vacancy.xlsx|xls|pdf   区役所の空き情報（xlsx・xls の区は CSV と自動照合する）
//   <区>/pdf-details.json       各施設「基本情報」PDFからの抽出結果（extract-pdf-details.mjs）
//   <区>/manual-details.json    自動抽出できない様式のPDFを目視転記したもの
//   <区>/ward-details.json      区の資料からの補完・ふりがな補正
//   <区>/websites.json          各施設の公式ホームページURL
//   <区>/kigyo_page.html        区役所「企業主導型保育事業所の空き情報」ページ
//   <区>/kigyo-details.json     認可外保育施設一覧（詳細）PDFからの抽出結果（extract-kigyo-details.mjs）
//   <区>/geocode-cache.json     企業主導型で座標が公開されていない施設の住所検索結果（国土地理院）
//
// Usage: node scripts/build-data.mjs
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { CITY_SOURCES, WARDS } from './wards.mjs';

const SRC = path.resolve('sources');
const OUT = path.resolve('src/data/facilities.json');
const KIGYO_DETAIL_PDF = 'https://www.city.osaka.lg.jp/kodomo/cmsfiles/contents/0000585/585842/21_sisetu_itiran_tiikiwaku_ari.pdf';

const readJson = async (...p) => {
  const file = path.join(SRC, ...p);
  return existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : {};
};
const normName = (s) =>
  s
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/^(?:幼保連携型|幼稚園型|保育所型)?認定こども園/, '')
    .replace(/[（(]夜間[)）]/, '');
const normPhone = (s) => s.normalize('NFKC').replace(/\D/g, '').replace(/^06/, '');
const cell = (v) => String(v).normalize('NFKC').replace(/\s+/g, ' ').trim();

// --- CSV（RFC4180 風の簡易パーサ。フィールド内の改行・引用符に対応）
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const endRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = '';
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else field += c;
  }
  if (field || row.length) endRow();
  return rows;
}

const vacancy = (v) => {
  // 「2名」（大正区の企業主導型）のように単位を付けた値もある
  const t = String(v ?? '').normalize('NFKC').trim().replace(/^(\d+)\s*[名人]$/, '$1');
  // 「※2」のような注記参照は、その施設では受け付けていない（他区の本園で保育など）年齢。注記は ward-details.json に転記する
  // 「無し」（西区）・「×」（城東区）はその年齢のクラスがない（受入れをしていない）
  if (t === '' || /^[-－―ー‐]$/.test(t) || /^※\d*$/.test(t) || t === '無し' || t === '×') return null;
  const n = Number(t);
  if (!Number.isFinite(n)) throw new Error(`unexpected vacancy value: ${v}`);
  return n;
};

/** 「1～2歳児で合計4人」「３歳～5歳で２名」のように複数の年齢で共有する空きの表記 */
const parseShared = (v) => {
  const m = String(v ?? '')
    .normalize('NFKC')
    .trim()
    .match(/^(\d)歳?児?[～~〜-](\d)歳児?で(?:合計)?(\d+)[人名]$/);
  if (!m) return null;
  const [from, to, count] = m.slice(1).map(Number);
  return { ages: Array.from({ length: to - from + 1 }, (_, k) => from + k), count };
};

const decode = (s) =>
  s
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();

/** 表の行ごとのセル（見出しセル th も含めて並び順のまま）。施設名を th に置く区がある（浪速区） */
const tableRows = (tableHtml) =>
  [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(([, tr]) =>
    [...tr.matchAll(/<t[hd]([^>]*)>([\s\S]*?)<\/t[hd]>/g)].map(([, attrs, html]) => ({
      span: Number(attrs.match(/colspan="(\d+)"/)?.[1] ?? 1),
      html,
      text: decode(html),
    })),
  );
// 見出しの施設名の列は「施設名」「保育事業所名」「施設・事業名」（城東区）「名称」（東住吉区）など
const HEADER_NAME = /施設名|事業所名|施設・事業名|^名称$/;
const isHeaderRow = (cells) => cells.some((c) => HEADER_NAME.test(c.text));

/**
 * xlsx の表（東成区・北区）を、見出し行（施設名の列がある行）と、その下の行ごとのセルに直す。
 * 施設名の列が空の行（表の下の注記など）は除く。末尾の空欄も見出しの列数まで空文字で埋める
 * blankIsZero: 空文字のセルを「空欄」とする（東淀川区は空文字のセルが空きなし、セルなしが受入れなし。照合で0として読む）
 */
function xlsxTable(file, blankIsZero = false) {
  const wb = XLSX.readFile(file);
  const all = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
  const at = all.findIndex((r) => r.some((c) => typeof c === 'string' && HEADER_NAME.test(cell(c))));
  if (at < 0) throw new Error(`${file}: 見出し行（施設名）が見つからない`);
  const headers = all[at].map((c) => (c == null ? '' : cell(c)));
  const nameCol = headers.findIndex((h) => HEADER_NAME.test(h));
  const rows = all
    .slice(at + 1)
    .filter((r) => typeof r[nameCol] === 'string' && r[nameCol].trim() && !/^[※●]/.test(r[nameCol].trim()))
    .map((r) => headers.map((_, k) => ({ span: 1, html: String(r[k] ?? ''), text: r[k] == null ? '' : r[k] === '' && blankIsZero && k !== nameCol ? '空欄' : cell(r[k]) })));
  return { headers, nameCol, rows };
}

/**
 * PDFの表（生野区・鶴見区・旭区の企業主導型の空き情報、旭区の空き情報）を、HTMLの表と同じ「行ごとのセル」に直す。
 * 見出し行（施設名・所在地・連絡先・0歳〜5歳）の位置から列の境界（隣り合う見出しの中間）を決め、
 * 同じ高さの文字を同じ行として各列に振り分ける。空欄の年齢は空文字のセル（= 受入れなし）になる
 * section: 1ページに複数の表がある資料（住之江区の空き情報は認可施設と企業主導型）で、この見出しより下の表だけを読む
 */
async function pdfTableRows(file, section = null) {
  const doc = await getDocument({ data: new Uint8Array(await readFile(file)), verbosity: 0 }).promise;
  const rows = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const items = (await (await doc.getPage(p)).getTextContent()).items
      .filter((i) => i.str.trim())
      .map((i) => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5] }));
    const marker = section && items.find((i) => i.s === section);
    if (section && !marker) continue;
    const below = (i) => !marker || i.y < marker.y;
    const ageHeads = items.filter((i) => below(i) && /^[0-5]\s*歳/.test(i.s.normalize('NFKC'))).sort((a, b) => a.x - b.x);
    // 施設名の見出しがない表（旭区の空き情報）は、年齢の見出しの1列ぶん左に施設名の列の見出しがあるものとする
    const header =
      items.filter((i) => below(i) && /^(?:保育)?施設名$/.test(i.s)).sort((a, b) => b.y - a.y)[0] ??
      (ageHeads.length === 6 ? { s: '施設名', x: 2 * ageHeads[0].x - ageHeads[1].x, y: ageHeads[0].y } : null);
    if (!header) continue;
    // 年齢の見出しが施設名の見出しより1行上にある表（旭区の企業主導型）も、同じ見出し行として扱う
    const cols = [
      ...new Set([header, ...items.filter((i) => Math.abs(i.y - header.y) <= 3), ...ageHeads.filter((i) => Math.abs(i.y - header.y) <= 15)]),
    ].sort((a, b) => a.x - b.x);
    const used = new Set(cols);
    // 年齢の見出しを「0／歳／児」と縦に1文字ずつ書く区（鶴見区）は、すぐ上下の「0」「児」もつないで「0歳児」にする
    const headerText = (c) => {
      const parts = c.s === '歳' ? items.filter((i) => Math.abs(i.x - c.x) <= 6 && Math.abs(i.y - c.y) <= 15).sort((a, b) => b.y - a.y) : [c];
      for (const i of parts) used.add(i);
      return parts
        .map((i) => i.s)
        .join('')
        .normalize('NFKC')
        .replace(/\s+/g, '');
    };
    rows.header ??= cols.map(headerText);
    const bounds = cols.slice(1).map((c, k) => (cols[k].x + c.x) / 2);
    const columnOf = (i) => bounds.filter((b) => i.x > b).length;
    const top = Math.min(...cols.map((c) => c.y)) - 3;
    const lines = [];
    for (const i of items.filter((i) => i.y < top && !used.has(i)).sort((a, b) => b.y - a.y || a.x - b.x)) {
      const line = lines.find((l) => Math.abs(l.y - i.y) <= 3);
      if (line) line.items.push(i);
      else lines.push({ y: i.y, items: [i] });
    }
    // 所在地・連絡先を2〜3行に分けて書く区（鶴見区・旭区）は、施設名の列が空の行を、上下13pt以内にある施設名の行に含める
    const named = lines.filter((l) => l.items.some((i) => columnOf(i) === 0));
    for (const l of lines.filter((l) => !named.includes(l))) {
      const near = named.filter((n) => Math.abs(n.y - l.y) <= 13).sort((a, b) => Math.abs(a.y - l.y) - Math.abs(b.y - l.y))[0];
      if (near) near.items.push(...l.items);
    }
    for (const line of named) {
      const texts = cols.map(() => []);
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
  return rows;
}
/** 区の表の施設名に付く「（注1）」などの注記参照や「【認定こども園】」（福島区）を外す */
const stripNoteRef = (s) => s.replace(/[（(]注\d*[)）]/g, '').replace(/【[^】]*】/g, '');

/**
 * 企業主導型の設置者名。市のPDFの値を基本にし、PDFで語が抜けている（区の表の値がPDFの値の文字をすべて順に含む）
 * ときだけ区の表の値を使う。区の表にも誤記があるため（例:「サエンス」）、単純には区の表を優先しない
 */
function pickOperator(fromPdf, fromWard) {
  const norm = (s) => s.normalize('NFKC').replace(/\s+/g, '');
  if (!fromPdf || !fromWard) return fromPdf || fromWard || null;
  const [p, w] = [norm(fromPdf), norm(fromWard)];
  let i = 0;
  for (const c of w) if (c === p[i]) i++;
  return i === p.length && w.length > p.length ? fromWard : fromPdf;
}

/** 国土地理院の住所検索で座標を求める（結果は sources/<区>/geocode-cache.json に保存して再利用） */
async function geocode(address, cache) {
  // 建物名・階数は検索の妨げになるので番地までにする
  const query = address.normalize('NFKC').match(/^.*?\d+(?:-\d+)*/)?.[0] ?? address;
  if (cache[query]) return cache[query];
  const res = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`住所検索に失敗 (${res.status}): ${query}`);
  const [hit] = await res.json();
  if (!hit || /[区市]$/.test(hit.properties.title)) throw new Error(`住所検索で町名まで一致しない: ${query}`);
  cache[query] = { lat: hit.geometry.coordinates[1], lng: hit.geometry.coordinates[0], label: hit.properties.title };
  return cache[query];
}

// 空き情報CSVで施設情報PDFのURLが空欄の施設（施設一覧ページ上のPDFと名称で対応付け）
const PDF_FALLBACK = {
  ブライトこども園大阪谷町: 'https://www.city.osaka.lg.jp/kodomo/cmsfiles/contents/0000012/12677/h5-10-buraitotanimachi.pdf',
  谷町中央こども園: 'https://www.city.osaka.lg.jp/kodomo/cmsfiles/contents/0000012/12677/h5-18-tanimachichuo.pdf',
  なにわのみやPreSchool: 'https://www.city.osaka.lg.jp/kodomo/cmsfiles/contents/0000012/12677/h5-23-naniwanomiya.pdf',
};
// 区の空き情報とCSVで名前の書き方がまったく違う施設（区の表の名前 → CSVの名前。空白除去）
const WARD_ROW_ALIASES = {
  '俊英舘保育園・こぐま分園': '俊英舘保育園分園こぐま園',
  // 西淀川区の表は保育所部分（光の園たんぽぽ保育園）と認定こども園の名前を並べて書いている
  '光の園たんぽぽ保育園光の園幼稚園(2・3号認定)': '光の園幼稚園',
  // 淀川区の空き情報は認定こども園への移行前の名前のまま（区の施設一覧では「まことよどがわこども園」、所在地は同じ）
  まことよどがわ保育園: 'まことよどがわこども園',
  // 港区の表は「保育所」を付けて書いている
  日輪学園保育所: '日輪学園',
};
const CATEGORY = { 保育所: 'nursery', 認定こども園: 'kodomoen', 地域型: 'community' };

const csv = parseCsv((await readFile(path.join(SRC, 'sukusukudata.csv'), 'utf8')).replace(/^﻿/, ''));
const [, ...csvRows] = csv;
// CSV には月しかないので、年はビルド日から推定する（12月に翌年1月分を取り込むケースも考慮）
const now = new Date();
const reiwa = (month) => (month > now.getMonth() + 2 ? now.getFullYear() - 1 : now.getFullYear()) - 2018;

const warnings = [];
const facilities = [];
const wards = [];

for (const ward of WARDS) {
  const warn = (msg) => warnings.push(`[${ward.name}] ${msg}`);
  const wardRows = csvRows.filter((r) => r[6] === ward.name);
  if (!wardRows.length) throw new Error(`${ward.name}: 空き情報CSVに該当行がない`);

  // --- 施設一覧 xlsx
  const wb = XLSX.readFile(path.join(SRC, ward.id, 'list.xlsx'));
  const list = XLSX.utils
    .sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 })
    .filter((r) => r.length >= 7 && r[0] !== '施設種別' && r[1])
    .map(([detailType, ownership, name, postalCode, address, phone, operator]) => ({
      detailType: cell(detailType),
      ownership: cell(ownership),
      name: cell(name),
      postalCode: cell(postalCode),
      address: cell(address),
      phone: cell(phone),
      operator: cell(operator),
    }));

  const pdfDetails = await readJson(ward.id, 'pdf-details.json');
  const manualDetails = await readJson(ward.id, 'manual-details.json');
  const wardDetails = await readJson(ward.id, 'ward-details.json');
  const websites = await readJson(ward.id, 'websites.json');
  const kigyoDetails = await readJson(ward.id, 'kigyo-details.json');
  const geocodeCache = await readJson(ward.id, 'geocode-cache.json');
  const listedPdfs = new Set(await readdir(path.join(SRC, ward.id, 'facility-pdfs')));
  const wardFacilities = [];
  const limitedRows = [];

  // --- 認可施設（保育所・認定こども園・地域型保育事業）
  for (const r of wardRows) {
    const [lat, lng, rawName, kana, address, , , phone, csvInfoUrl, category, v0, v1, v2, v3, v4, v5, , , , sortKey] = r;
    const name = cell(rawName);
    const key = normName(rawName);
    // 「３歳～5歳で２名」（最初の年齢の欄に書き、残りは空欄）は、該当年齢で共有する空きとして扱う
    const raw = [v0, v1, v2, v3, v4, v5];
    const sharedVacancy = raw.map(parseShared).find(Boolean) ?? null;
    // 「調整中」（東住吉区）は受入れ可否が未定の年齢。空き人数は出さず注記に残す
    const pendingAges = raw.flatMap((v, age) => (cell(v ?? '') === '調整中' ? [age] : []));
    const vacancies = raw.map((v, age) =>
      sharedVacancy?.ages.includes(age) ? sharedVacancy.count : pendingAges.includes(age) ? null : vacancy(v),
    );
    // 「〇〇【期間限定】」「〇〇【期間限定保育】」（西淀川区）は同じ施設の期間限定保育の枠（別行）。施設カードの注記にまとめる
    if (/【期間限定(?:保育)?】/.test(name)) {
      limitedRows.push({ id: `${ward.id}-${sortKey}`, name, vacancies });
      continue;
    }
    // 分園などで空き人数が本園に含まれる行（全年齢「-」で施設情報もない）は除外する
    if (vacancies.every((v) => v === null) && !csvInfoUrl) {
      warn(`空き人数が全年齢「-」のため除外: ${name}`);
      continue;
    }
    // 電話番号で対応付ける。同じ番号が複数（本園・分園など）のときだけ名前の先頭でも確かめる
    // （一覧の名前は法人名付き「学校法人〇〇 …すみれ幼稚園」や、文字化け的な異体字「ＣоｎоＣо」のことがある）
    const samePhone = list.filter((l) => normPhone(l.phone) === normPhone(phone));
    const listed =
      (samePhone.length === 1 ? samePhone[0] : samePhone.find((l) => normName(l.name).slice(0, 4) === key.slice(0, 4))) ??
      list.find((l) => normName(l.name) === key);
    if (!listed) warn(`施設一覧に見つからない: ${name}`);

    // CSVのPDFのURLが施設一覧ページにない（リンク切れ）ものは載せない
    const infoUrl = [csvInfoUrl, PDF_FALLBACK[key]].find((u) => u && listedPdfs.has(u.split('/').pop()));
    if (csvInfoUrl && !infoUrl) warn(`CSVの施設情報PDFが施設一覧ページにないため非掲載: ${name} ${csvInfoUrl}`);
    const pdfFile = infoUrl?.split('/').pop();
    const auto = pdfFile ? pdfDetails[pdfFile] : undefined;
    const manual = pdfFile ? manualDetails[pdfFile] : undefined;
    const extra = wardDetails[key];
    const detail = auto || manual || extra?.weekday || extra?.note ? { ...extra, ...auto, ...manual, note: manual?.note ?? extra?.note ?? auto?.note ?? null } : null;
    if (!detail?.weekday) warn(`施設の詳細情報（開所時間）なし: ${name}`);
    // ふりがな: 手動補正 > 基本情報PDF > 空き情報CSV（CSVは仮称・旧名称のままのものがある）
    const reading = (
      extra?.kana ??
      auto?.kana?.replace(/^(?:ようほれんけいがた|ようちえんがた|ほいくしょがた)?にんていこどもえん/, '') ??
      kana
    ).replace(/[\s　]+/g, '');
    const site = websites[key];
    if (!CATEGORY[category]) throw new Error(`unknown category: ${category}`);
    // CSVの施設番号が別の施設と重なっていることがある（鶴見区のポピンズナーサリースクール鶴見緑地と茨田東こども園）。後の行は基本情報PDFの名前を足して区別する
    const baseId = `${ward.id}-${sortKey}`;
    const id = wardFacilities.some((x) => x.id === baseId) ? `${baseId}-${(pdfFile ?? key).replace(/\.pdf$/, '')}` : baseId;
    if (id !== baseId) warn(`CSVの施設番号 ${sortKey} が重複しているため、IDを ${id} にした: ${name}`);

    wardFacilities.push({
      id,
      ward: ward.id,
      wardName: ward.name,
      // CSVの施設名の誤記（旭区「AIAI NIMI 太子橋今市」）は ward-details.json の name で直す
      name: extra?.name ?? name,
      kana: reading,
      category: CATEGORY[category],
      categoryLabel: category === '地域型' ? '地域型保育事業' : category,
      detailType: listed?.detailType ?? null,
      ownership: listed?.ownership ?? null,
      operator: listed?.operator ?? null,
      postalCode: listed?.postalCode ?? null,
      // CSVの住所は区名から始まる。区名が抜けている行（本園・分園の併記など）は施設一覧の住所を使う
      // 仮園舎が他区にある施設（都島区の毛馬保育所は旭区赤川）は、その区名のまま使う
      address: `大阪市${/^\S+?区/.test(cell(address)) ? cell(address) : (listed?.address ?? `${ward.name}${cell(address)}`)}`,
      phone: cell(phone),
      lat: Number(lat),
      lng: Number(lng),
      vacancies,
      sharedVacancy,
      licensed: true,
      // 昼間と夜間で共有するPDFの定員は昼間の分なので、夜間保育所の行には出さない
      capacity: /夜間/.test(name) && detail?.nightHours ? null : (detail?.capacity ?? null),
      // 昼間と夜間で1つのPDFを共有する施設は、夜間保育所の行に夜間の開所時間（月〜土）を使う
      hours: /夜間/.test(name) && detail?.nightHours
        ? { weekday: detail.nightHours, saturday: detail.nightHours, holiday: null }
        : detail?.weekday
          ? { weekday: detail.weekday, saturday: detail.saturday ?? null, holiday: null }
          : null,
      services: detail?.services ?? [],
      approvedOn: detail?.approvedOn ?? null,
      note:
        [
          detail?.note,
          sharedVacancy && `${sharedVacancy.ages.join('・')}歳クラスの空きはあわせて${sharedVacancy.count}人です。`,
          pendingAges.length && `${pendingAges.join('・')}歳クラスの空きは区の空き情報で「調整中」です。`,
          /夜間/.test(name) && detail?.nightHours && '開所時間は市の施設基本情報PDF（昼間の保育所と共通）の夜間の欄より。PDFに夜間の定員の記載がないため、定員は掲載していません。',
        ]
          .filter(Boolean)
          .join('') || null,
      // websites.json に url: null で載っている施設は、リンク切れ等のため意図的に非掲載
      website: site ? site.url : (detail?.url ?? null),
      websiteLabel: site?.url ? site.label : !site && detail?.url ? '施設URL（市の施設基本情報より）' : null,
      infoPdfUrl: infoUrl ?? null,
      infoPdfLabel: infoUrl ? '市の施設基本情報(PDF)' : null,
    });
  }

  for (const l of limitedRows) {
    // 本体と同じ施設番号の区（天王寺区）と、別の番号の区（西淀川区）があるので、番号がなければ名前で探す
    const base = normName(l.name.replace(/\s*【期間限定(?:保育)?】/, ''));
    const f = wardFacilities.find((x) => x.id === l.id) ?? wardFacilities.find((x) => normName(x.name) === base);
    if (!f) throw new Error(`${ward.name}: 期間限定枠の本体の施設がない: ${l.name}`);
    // 空きのある年齢があればその年齢だけを書く（区の表では枠のない年齢は空欄）
    const ages = l.vacancies.some((v) => v > 0) ? l.vacancies.map((v) => v > 0) : l.vacancies.map((v) => v !== null);
    const open = l.vacancies.map((v, age) => (ages[age] ? `${age}歳児${v}人` : null)).filter(Boolean);
    f.note = `${f.note ? `${f.note}` : ''}期間限定保育の枠もあります（空き: ${open.join('・')}）。`;
  }

  // --- 区の公表値との照合（CSV と区役所の空き情報が一致しているか）
  // 区によって xlsx（東成区）またはページ本文の表（天王寺区）で公表している。PDFのみの区（中央区）は目視で照合する
  // 「第2」と「第二」の表記ゆれ（生野区の表とCSV）や「・」の有無（鶴見区「えがおの森保育園・つるみ」）、括弧の種類も同じ名前として扱う
  // 「(夜間)」は外さない（北区の大淀保育所は昼間と夜間で別の行・別の施設）
  const stripCity = (s) =>
    s
      .normalize('NFKC')
      .replace(/[\s・]+/g, '')
      // 「えーむ」と『えーむ』（住之江区の表とCSV）も同じ名前として扱う
      .replace(/『/g, '「')
      .replace(/』/g, '」')
      .replace(/^(?:幼保連携型|幼稚園型|保育所型)?認定こども園/, '')
      .replace(/^大阪市立/, '')
      .replace(/第([一二三四五六七八九])/g, (_, k) => `第${'一二三四五六七八九'.indexOf(k) + 1}`);
  const wardRowsToCheck = [];
  // 鶴見区は旧形式の xls で公表している（SheetJS はどちらも読める）
  const vacancyXlsx = ['vacancy.xlsx', 'vacancy.xls'].map((f) => path.join(SRC, ward.id, f)).find(existsSync);
  if (vacancyXlsx) {
    // 見出し行から施設名の列と「0歳」の列を探す（東成区は1列目が施設名、北区は区分・施設名・所在地の後に年齢）
    const { headers: vh, nameCol, rows: vrows } = xlsxTable(vacancyXlsx, ward.blankIsZero);
    const ageCol = vh.findIndex((h) => /^0歳/.test(h));
    for (const r of vrows) {
      const vals = r.slice(ageCol, ageCol + 6).map((c) => c.text);
      if (vals.every((v) => v === '')) continue;
      wardRowsToCheck.push({ names: [r[nameCol].text], vals });
    }
  }
  const vacancyPage = path.join(SRC, ward.id, 'vacancy_page.html');
  const pageHtml = existsSync(vacancyPage) ? await readFile(vacancyPage, 'utf8') : '';
  // 施設種別ごとに表を分けている区（東住吉区）もあるので、年齢別の空きの表はすべて読む
  const pageTables = [...pageHtml.matchAll(/<table[\s\S]*?<\/table>/g)]
    .map(([t]) => t)
    .filter((t) => tableRows(t).some(isHeaderRow) && /0歳/.test(t));
  if (!wardRowsToCheck.length) {
    for (const row of pageTables.flatMap((t) => tableRows(t))) {
      // 結合セルは列数ぶんに展開する。福島区の小規模保育は3〜5歳の欄が上の行から縦に結合されていて、
      // 2行目以降は「施設名・0歳・1歳・2歳」の4列しかないので、3〜5歳を空欄として補う
      let cells = row.flatMap((c) => [c.text, ...Array(c.span - 1).fill('')]);
      if (cells.length === 4 && cells.slice(1).every((v) => /^\d+$/.test(v))) cells = [...cells, '', '', ''];
      // 末尾6列が年齢別の空き人数。その前の列（区分・施設名・所在地・電話）のどれかが施設名
      if (cells.length < 7 || isHeaderRow(row) || /期間限定/.test(cells.join(''))) continue;
      // 表の中の空行・区分だけの行（福島区）は飛ばす
      if (cells.slice(-6).every((v) => v === '') || cells.slice(0, -6).every((n) => !n)) continue;
      wardRowsToCheck.push({ names: cells.slice(0, -6), vals: cells.slice(-6) });
    }
  }
  // 添付PDFの表だけで公表している区（旭区）は、PDFの表を列の位置で読む
  const vacancyPdf = path.join(SRC, ward.id, 'vacancy.pdf');
  if (!wardRowsToCheck.length && existsSync(vacancyPdf)) {
    for (const r of await pdfTableRows(vacancyPdf)) wardRowsToCheck.push({ names: [r[0].text], vals: r.slice(-6).map((c) => c.text) });
  }
  if (wardRowsToCheck.length) console.log(`[${ward.name}] 区の空き情報 ${wardRowsToCheck.length} 施設とCSVを照合`);
  // 「Four Leaf (フォーリーフ)」のように末尾に読みを添えた名前は、読みを外した形でも探す
  // 「育（はぐくみ）福島本園」のように途中に読みが入る名前は、読みを外した形でも探す
  // 「のぎく保育園(分園）」とCSVの「のぎく保育園 分園」（鶴見区）のように、末尾の括弧だけが違う名前は括弧を外した形でも探す
  const rowKeys = (names) =>
    names.flatMap((n) => [
      stripCity(WARD_ROW_ALIASES[n.normalize('NFKC').replace(/\s+/g, '')] ?? stripNoteRef(n)),
      stripCity(stripNoteRef(n)).replace(/[(]([^)]*)[)]$/, '$1'),
      stripCity(stripNoteRef(n).replace(/\s*[(（][^)）]*[)）]$/, '')),
      stripCity(stripNoteRef(n).replace(/[(（][^)）]*[)）]/g, '')),
    ]);
  const allWardKeys = new Set(wardRowsToCheck.flatMap((r) => rowKeys(r.names)));
  for (const { names, vals } of wardRowsToCheck) {
    const keys = rowKeys(names);
    // 名前のそのままの形 → 読みを外した形の順に、完全一致を優先して探す
    const f =
      keys.map((k) => wardFacilities.find((x) => stripCity(x.name) === k)).find(Boolean) ??
      // 「すぎな保育園（分園）」とCSVの「すぎな保育園 ながれまち園(分園)」（平野区）のように、間に園名が入る分園は前後で探す
      keys
        .map((k) => k.match(/^(.{4,}?)([(][^)]*[)])$/))
        .filter(Boolean)
        .map(([, base, paren]) => wardFacilities.find((x) => stripCity(x.name).startsWith(base) && stripCity(x.name).endsWith(paren)))
        .find(Boolean) ??
      wardFacilities.find((x) => keys.some((k) => k.length >= 4 && stripCity(x.name).startsWith(k))) ??
      // CSVの名前に法人名が前に付いている施設（都島区「社会福祉法人 大阪婦人ホーム 子ロバ乳児園」）
      wardFacilities.find((x) => keys.some((k) => k.length >= 4 && stripCity(x.name).endsWith(k)));
    if (!f) {
      warn(`区の空き情報の施設がCSVにない: ${names.join(' / ')}`);
      continue;
    }
    // 「調整中」はCSVでも同じ表記で、空き人数なし（注記つき）として扱っている
    // 「（注2）」のように注記で書かれた年齢（淀川区のポコ こまどり「1歳児クラス及び2歳児クラスで、1名まで利用可」）は、注記の文から共有枠として読む
    const noteRefs = vals.map((v) => v.normalize('NFKC').match(/^\(注(\d+)\)$/)?.[1]);
    const ref = noteRefs.find(Boolean);
    let noteShared = null;
    if (ref) {
      const m = decode(pageHtml).normalize('NFKC').match(new RegExp(`\\(注${ref}\\)\\s*([0-5])歳児クラス及び([0-5])歳児クラスで、(\\d+)名まで`));
      if (!m) throw new Error(`${ward.name}: 区の空き情報の注記（注${ref}）を読めない: ${f.name}`);
      noteShared = { ages: noteRefs.flatMap((r, age) => (r === ref ? [age] : [])), count: Number(m[3]) };
    }
    // 「空欄」（東淀川区の空きなし）は0。ただしCSVで受入れのないクラスは、区のxlsでも空欄になっていることがある（小松保育園の3〜5歳。基本情報PDFの定員も0人）ので受入れなしのまま
    const expected = vals.map((v, age) =>
      noteShared?.ages.includes(age) ? noteShared.count : v === '空欄' ? (f.vacancies[age] === null ? null : 0) : v === '調整中' ? null : vacancy(v),
    );
    // 本園と分園を1行にまとめて公表する区がある（西区）。CSVでは別行なので、分園と合算して比べる
    // （分園にも区の表の行がある区では合算しない）
    const branches = wardFacilities.filter(
      (x) => x !== f && /分園/.test(x.name) && stripCity(x.name).startsWith(stripCity(f.name)) && !allWardKeys.has(stripCity(x.name)),
    );
    if (branches.length) {
      const combined = f.vacancies.map((v, age) => {
        const vs = [v, ...branches.map((b) => b.vacancies[age])].filter((n) => n !== null);
        return vs.length ? vs.reduce((a, b) => a + b, 0) : null;
      });
      if (expected.some((v, i) => (v ?? 0) !== (combined[i] ?? 0))) {
        warn(`区の空き情報（本園・分園の合計）とCSVが不一致: ${f.name} 区=${expected.join(',')} CSV合計=${combined.join(',')}`);
      }
      continue;
    }
    // 北区のCSVは受入れのないクラスも「0」としているので、区の表が空欄（クラスなし）でCSVが0のときは違いとみなさず、区の値に合わせる
    const differs = (v, i) => v !== f.vacancies[i] && !(v === null && f.vacancies[i] === 0);
    if (!expected.some(differs) && expected.some((v, i) => v !== f.vacancies[i])) {
      f.vacancies = expected;
      if (f.sharedVacancy?.ages.some((a) => expected[a] === null)) f.sharedVacancy = null;
    }
    if (expected.some(differs)) {
      // 区の公表値を優先して表示し、市のデータとの違いは注記に残す
      warn(`区の空き情報とCSVが不一致（区の値を採用）: ${f.name} 区=${expected.join(',')} CSV=${f.vacancies.join(',')}`);
      const s = f.sharedVacancy;
      const diff = s
        ? [`${s.ages[0]}〜${s.ages.at(-1)}歳であわせて${s.count}人`]
        : expected.flatMap((v, age) => {
            const csvValue = f.vacancies[age];
            return v === csvValue ? [] : [csvValue === null ? `${age}歳児は空欄` : `${age}歳児${csvValue}人`];
          });
      const sharedNote = s && `${s.ages.join('・')}歳クラスの空きはあわせて${s.count}人です。`;
      f.note = `${(f.note ?? '').replace(sharedNote || '\0', '')}空き人数は区の公表値です（大阪市の空き情報マップのデータでは${diff.join('・')}）。`;
      f.vacancies = expected;
      f.sharedVacancy = null;
    }
    if (noteShared) {
      f.sharedVacancy = noteShared;
      f.note = `${f.note ?? ''}${noteShared.ages.join('・')}歳クラスの空きはあわせて${noteShared.count}人です（区の空き情報の注記）。`;
    }
  }

  // --- 企業主導型保育事業（認可外）
  // 空き人数【地域枠】: 区役所「企業主導型保育事業所の空き情報」ページの表。
  // 位置: 住所セルに大阪市マップナビのリンクがあればその座標、なければ国土地理院の住所検索。
  // 開所時間・定員・設置者: 大阪市「地域の児童が利用できる認可外保育施設一覧（詳細）」PDF
  const kigyoHtml = await readFile(path.join(SRC, ward.id, 'kigyo_page.html'), 'utf8');
  const kigyoTables = [...kigyoHtml.matchAll(/<table[\s\S]*?<\/table>/g)].map(([t]) => t);
  // 年齢の列がある表が空き情報の表（淀川区は所在地・電話の一覧表が先にある）
  const table = kigyoTables.find((t) => /0歳/.test(t)) ?? kigyoTables[0] ?? '';
  // 時点は表の見出し（caption）、PDFで公表している区はページ本文の「2026年（令和8年）10月1日現在」から読む
  // 「令和8 年10 月1日現在」（大正区）のように数字と年月日の間に空白が入ることもある
  const AS_OF = /(令和\s*\d+)\s*年[)）]?\s*(\d+)\s*月\s*(\d+)\s*日\s*(?:現在|時点)/;
  const asOfMatch = decode(table.match(/<caption>([\s\S]*?)<\/caption>/)?.[1] ?? '').match(AS_OF) ?? decode(kigyoHtml).match(AS_OF);
  let kigyoAsOf = asOfMatch ? `${asOfMatch[1].replace(/\s+/g, '')}年${asOfMatch[2]}月${asOfMatch[3]}日現在` : null;
  const surveyDates = new Set();
  // 区によっては表に「設置者」列がある（天王寺区）。あれば市のPDFより優先する（PDFは改行で途切れることがある）
  // 見出しは1行目のセル（施設名の列を th にしている区があるので、表全体の th は使わない）
  // 空き情報の表: ページ内の表、添付のxlsx（北区）、添付のPDF（生野区）のいずれか
  const kigyoXlsx = path.join(SRC, ward.id, 'kigyo.xlsx');
  const kigyoPdf = path.join(SRC, ward.id, 'kigyo.pdf');
  let headers;
  let kigyoRows;
  if (ward.kigyoFile && existsSync(kigyoXlsx)) {
    ({ headers, rows: kigyoRows } = xlsxTable(kigyoXlsx));
  } else if (ward.kigyoFile) {
    kigyoRows = await pdfTableRows(kigyoPdf, ward.kigyoPdfSection);
    headers = kigyoRows.header ?? [];
  } else {
    headers = (tableRows(table).find(isHeaderRow) ?? []).map((c) => c.text);
    kigyoRows = tableRows(table);
  }
  const operatorCol = headers.indexOf('設置者');
  const kigyoByAddress = (address) => {
    // 「靭」「靱」の異体字や、部屋番号を番地に続けて書くか（1-15-9-201）建物名の後に書くかの違いを吸収する
    const key = (s) =>
      s.normalize('NFKC').replace(/^大阪市/, '').replace(new RegExp(`^${ward.name}`), '').replace(/靭/g, '靱').replace(/[－ー―]/g, '-').match(/^\D+\d+(?:-\d+)*/)?.[0];
    const entries = Object.entries(kigyoDetails);
    const prefixHits = entries.filter(([, d]) => {
      const [a, b] = [key(d.address), key(address)];
      return a && b && (a.startsWith(`${b}-`) || b.startsWith(`${a}-`));
    });
    const hit = entries.find(([, d]) => key(d.address) === key(address)) ?? (prefixHits.length === 1 ? prefixHits[0] : undefined);
    return hit && { ...hit[1], phone: hit[0] };
  };
  // 表の先頭に全列を結合した表題の行がある区（住吉区）もあるので、1セルだけの行は除く
  const rows = kigyoRows.filter((cells) => cells.length > 1 && !isHeaderRow(cells));
  // 空き情報の表に所在地・電話がない区は、区の施設一覧ページの表（浪速区。2列目が所在地）か、
  // 添付の企業主導型保育事業所一覧PDF（阿倍野区。「所在地」「電話番号」列）から補う
  const infoFile = path.join(SRC, ward.id, 'kigyo_info_page.html');
  const infoPdf = path.join(SRC, ward.id, 'kigyo_info.pdf');
  let infoRows = [];
  let infoCols = [1];
  if (existsSync(infoFile)) {
    infoRows = [...(await readFile(infoFile, 'utf8')).matchAll(/<table[\s\S]*?<\/table>/g)].flatMap(([t]) => tableRows(t));
  } else if (ward.kigyoInfoFile) {
    infoRows = await pdfTableRows(infoPdf);
    infoCols = infoRows.header.flatMap((h, k) => (/所在地|電話/.test(h) ? [k] : []));
  } else if (!ward.kigyoFile && kigyoTables.length > 1) {
    // 空き情報の表とは別に「所在地」「連絡先」の一覧表を載せている区（西成区は空き情報の下、淀川区は上）
    infoRows = kigyoTables.filter((t) => t !== table).flatMap((t) => tableRows(t));
    infoCols = (infoRows.find(isHeaderRow) ?? []).flatMap((c, k) => (/所在地|電話|連絡先/.test(c.text) ? [k] : []));
  }
  const infoKey = (s) => normName(stripNoteRef(s));
  // 年齢の列の後ろに「調査日」などの列がある区（阿倍野区）は、その列を年齢から外して注記に使う
  // 見出しは「5歳」「５歳児クラス」「人数（5歳）」（都島区）など
  const lastAgeCol = headers.findIndex((h) => /(?:^|\()5歳/.test(h));
  const trailingCols = lastAgeCol > 0 ? headers.length - 1 - lastAgeCol : 0;

  for (const [idx, rowCells] of rows.entries()) {
    const cells = trailingCols ? rowCells.slice(0, -trailingCols) : rowCells;
    const surveyedOn = trailingCols ? rowCells.slice(-trailingCols).map((c) => c.text).find((t) => /^令和\d+年\d+月\d+日$/.test(t)) : null;
    if (surveyedOn) surveyDates.add(surveyedOn);
    // 「備考」列（都島区）に記載があれば注記に残す
    const remarks = trailingCols ? rowCells.slice(-trailingCols).map((c) => c.text).filter((t) => t && t !== surveyedOn) : [];
    // 末尾の年齢セル（結合セルを含めて6歳分）と、その前の住所・連絡先セルに分ける
    const ageCells = [];
    let span = 0;
    for (let i = cells.length - 1; span < 6; i--) {
      ageCells.unshift(cells[i]);
      span += cells[i].span;
    }
    const [nameCell, ...ownInfoCells] = cells.slice(0, cells.length - ageCells.length);
    let name = nameCell.text;
    let infoCells = ownInfoCells;
    // 区の表に所在地も補う資料もない区（福島区）は、市の認可外保育施設一覧（詳細）と施設名で対応付ける
    // （区の表と市の一覧で冠の有無が違うことがあるので、どちらかがもう一方を含むものを1件だけ探す）
    let byName = null;
    if (!infoCells.length && !infoRows.length) {
      const k = infoKey(name);
      const hits = Object.entries(kigyoDetails).filter(([, d]) => {
        const dk = infoKey(d.name);
        return dk === k || (Math.min(dk.length, k.length) >= 4 && (dk.includes(k) || k.includes(dk)));
      });
      if (hits.length !== 1) throw new Error(`${ward.name}: 企業主導型を市の一覧と施設名で対応付けられない: ${name}（候補${hits.length}件）`);
      byName = { ...hits[0][1], phone: hits[0][0] };
    } else if (!infoCells.length) {
      const info = infoRows.find((r) => r.length > 1 && infoKey(r[0].text) === infoKey(name));
      if (!info) throw new Error(`${ward.name}: 企業主導型の所在地が区の施設一覧にない: ${name}`);
      infoCells = infoCols.map((k) => info[k]);
    }

    // 「1・2歳で1人」のように年齢をまたいで結合されたセルは、どちらの年齢でも使える共有枠として扱う
    // 「調整中」は受入れ可否が未定の年齢。空きなしとは区別して注記に残す
    const vacancies = [];
    let sharedVacancy = null;
    const pendingAges = [];
    for (const c of ageCells) {
      const ages = Array.from({ length: c.span }, (_, k) => vacancies.length + k);
      // 結合せずに各年齢のセルへ「1～2歳児で合計4人」と書く区もある（西区）
      const shared = parseShared(c.text);
      // 凡例が「空欄は空きなし」の区（東淀川区）は、空欄を0とする（受入れのないクラスは「×」）
      const v = c.text === '調整中' ? null : shared ? shared.count : vacancy(ward.blankIsZero && c.text === '' ? '0' : c.text);
      if (c.text === '調整中') pendingAges.push(...ages);
      else if (shared) sharedVacancy = shared;
      // 結合セルが「0」（西成区）なら各年齢とも空きなしで、共有枠の注記は要らない
      else if (c.span > 1 && v) sharedVacancy = { ages, count: v };
      for (let k = 0; k < c.span; k++) vacancies.push(v);
    }
    // 「3～5歳で合計1名」を最初の年齢の欄だけに書き、残りを空欄にしている区（北区）もあるので、範囲の全年齢に入れる
    if (sharedVacancy) for (const a of sharedVacancy.ages) vacancies[a] = sharedVacancy.count;

    const operatorCell = operatorCol > 0 ? cells[operatorCol] : null;
    // タグの境目で番地と電話番号がつながらないよう（「…タワー202」＋「06-…」）、タグは空白にしてから読む
    const infoText = infoCells
      .filter((c) => c !== operatorCell)
      .map((c) => decode(c.html.replace(/<[^>]+>/g, ' ')))
      .join(' ')
      // 電話番号の区切りに「‐」（U+2010）を使う区（大正区）もある
      .replace(/(\d)[‐‑－―ー](?=\d)/g, '$1-');
    const phone = byName?.phone ?? infoText.match(/0\d{1,4}-\d{1,4}-\d{3,4}/)?.[0];
    if (!phone) throw new Error(`${ward.name}: 企業主導型の電話番号が読めない: ${name}`);
    const shortAddress = infoText.replace(phone, '').replace(/[()（）]/g, '').trim().replace(new RegExp(`^${ward.name}`), '');
    // 電話番号で対応付け。区の表と市のPDFで電話番号が違う施設は所在地（番地まで）で対応付ける
    const d = byName ?? kigyoDetails[phone] ?? kigyoByAddress(shortAddress);
    if (!d) warn(`認可外保育施設一覧（詳細）に見つからない: ${name}`);
    else if (byName) warn(`区の表に所在地がないため、市の一覧の「${d.name}」と施設名で対応付け: ${name}`);
    else if (d.phone.startsWith('(電話番号なし)')) warn(`市の一覧に電話番号がないため所在地で対応付け: ${name}`);
    else if (!kigyoDetails[phone]) warn(`電話番号が市の一覧（${d.phone}）と違うため所在地で対応付け: ${name} ${phone}`);
    const address = d?.address.normalize('NFKC') ?? `大阪市${ward.name}${shortAddress}`;
    // PDFの表（鶴見区）では、施設名の末尾の語（「ぴじょんがーでん保育園 優」の「優」）が隣の所在地の列に入ってしまうことがある。
    // 市の一覧の名前が、区の表の名前に空白で区切った1語を足しただけなら、市の一覧の名前を使う
    const cityName = d?.name.normalize('NFKC');
    if (ward.kigyoFile && cityName?.startsWith(`${name} `) && !/\s/.test(cityName.slice(name.length + 1))) name = cityName;
    // 区の表のセル内で改行している名前（東淀川区「菅原天満くすのき<br>保育園」）は、空白を除いて市の一覧と同じなら市の一覧の書き方にする
    if (/<br/i.test(nameCell.html) && cityName && cityName.replace(/\s+/g, '') === name.replace(/\s+/g, '')) name = cityName;

    const mapnavi = infoCells.map((c) => c.html).join(' ');
    const mpx = Number(mapnavi.match(/mpx=([\d.]+)/)?.[1]);
    const mpy = Number(mapnavi.match(/mpy=([\d.]+)/)?.[1]);
    const position = mpx && mpy ? { lat: mpy, lng: mpx } : await geocode(address, geocodeCache);
    const site = websites[normName(name)];

    wardFacilities.push({
      id: `${ward.id}-kigyo-${String(idx + 1).padStart(2, '0')}`,
      ward: ward.id,
      wardName: ward.name,
      name,
      kana: '',
      category: 'kigyo',
      categoryLabel: '企業主導型（認可外）',
      detailType: '認可外保育施設',
      ownership: null,
      operator: pickOperator(d?.operator, operatorCell?.text),
      postalCode: d?.postalCode ?? null,
      address,
      phone,
      lat: position.lat,
      lng: position.lng,
      vacancies,
      sharedVacancy,
      licensed: false,
      capacity: d?.capacity ? { total: d.capacity, byAge: [] } : null,
      hours: d?.hours.weekday
        ? { weekday: d.hours.weekday, saturday: d.hours.saturday ?? null, holiday: d.hours.holiday ?? null }
        : null,
      services: [...(d?.hours.holiday ? ['日祝保育'] : []), ...(d?.freeOfCharge ? ['国の無償化対象'] : [])],
      approvedOn: null,
      note:
        [
          sharedVacancy && `${sharedVacancy.ages.join('・')}歳クラスの空きはあわせて${sharedVacancy.count}人です（区の一覧で結合表記）。`,
          surveyedOn && `空き人数は${surveyedOn}の区の調査時点の値です。`,
          remarks.length && `区の表の備考：${remarks.join('、')}。`,
          pendingAges.length && `${pendingAges[0]}〜${pendingAges.at(-1)}歳クラスは区の一覧で「調整中」です。`,
          d?.monthlyUpTo && `月極保育の対象は${d.monthlyUpTo}まで。`,
          d?.startedOn && `事業開始 ${d.startedOn}。`,
          !(mpx && mpy) && '地図の位置は住所から推定しています。',
          wardDetails[normName(name)]?.note,
        ]
          .filter(Boolean)
          .join('') || null,
      website: site?.url ?? null,
      websiteLabel: site?.url ? site.label : null,
      infoPdfUrl: d ? `${KIGYO_DETAIL_PDF}#page=${d.page}` : null,
      infoPdfLabel: d ? '市の認可外保育施設一覧(PDF)' : null,
    });
  }
  // 表に時点の記載がなく施設ごとの調査日だけがある区（阿倍野区）は、調査日を時点として出す
  if (!kigyoAsOf && surveyDates.size) kigyoAsOf = `${[...surveyDates].sort().join('・')}調査`;
  if (Object.keys(geocodeCache).length) {
    await writeFile(path.join(SRC, ward.id, 'geocode-cache.json'), JSON.stringify(geocodeCache, null, 2) + '\n');
  }

  const ids = wardFacilities.map((f) => f.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`${ward.name}: 施設IDが重複: ${dup}`);

  // 補完ファイルのキーの打ち間違い検出
  // 施設名を直したもの（ward-details.json の name）は、CSVの名前のキーで書いている
  const renamedKeys = Object.entries(wardDetails).flatMap(([k, d]) => (d.name && wardFacilities.some((f) => f.name === d.name) ? [k] : []));
  const knownKeys = new Set([...wardFacilities.map((f) => normName(f.name)), ...renamedKeys]);
  for (const file of [websites, wardDetails]) {
    for (const k of Object.keys(file)) {
      if (!k.startsWith('_') && !knownKeys.has(k)) warn(`対応する施設がないキー: ${k}`);
    }
  }

  const asOfMonth = Number(wardRows[0][16]);
  wards.push({
    id: ward.id,
    name: ward.name,
    vacancyAsOf: `令和${reiwa(asOfMonth)}年${asOfMonth}月1日現在`,
    vacancyFor: `${Number(wardRows[0][20])}月1日入所用`,
    kigyoVacancyAsOf: kigyoAsOf,
    sources: [
      { label: `${ward.name}役所「保育施設等の空き状況」`, url: ward.vacancyPage },
      { label: `大阪市「保育施設等一覧（${ward.name}）」（施設種別・運営法人・各施設基本情報PDF）`, url: ward.listPage },
      ...ward.homepageSources.map((s) => ({ label: `${ward.name}役所「${s.label}」（各施設のホームページ）`, url: s.url })),
      { label: `${ward.name}役所「企業主導型保育事業所の空き情報」（企業主導型の空き人数【地域枠】）`, url: ward.kigyoPage },
      ...(ward.kigyoInfoPage ? [{ label: `${ward.name}役所の施設一覧（企業主導型の所在地・位置）`, url: ward.kigyoInfoPage }] : []),
    ],
  });
  facilities.push(...wardFacilities);
}

const data = {
  generatedAt: now.toISOString(),
  wards,
  commonSources: [
    { label: '大阪市「保育施設等 空き情報マップ」（位置情報・空き人数データ）', url: CITY_SOURCES.vacancyMap },
    { label: '大阪市「地域の児童が利用できる認可外保育施設一覧」（企業主導型の開所時間・定員・設置者）', url: CITY_SOURCES.ninkagaiPage },
  ],
  facilities,
};

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(data, null, 2) + '\n');
console.log(
  `wrote ${facilities.length} facilities -> ${path.relative(process.cwd(), OUT)}  (${wards
    .map((w) => `${w.name} ${facilities.filter((f) => f.ward === w.id).length}`)
    .join(', ')})`,
);
for (const w of warnings) console.warn(`  ! ${w}`);
