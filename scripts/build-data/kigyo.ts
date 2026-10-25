import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Facility } from '../../src/schema.ts';
import type { WardConfig } from '../wards.ts';
import type { KigyoDetail } from '../data-schema.ts';
import type { TableCell, Warn } from './types.ts';
import { SRC } from './inputs.ts';
import type { WardInputs } from './inputs.ts';
import { normName, stripNoteRef, parseShared, vacancy } from './text.ts';
import { decode, tableRows, isHeaderRow } from './html.ts';
import { xlsxTable } from './xlsx.ts';
import { pdfTableRows } from './pdf.ts';
import { geocode } from './geocode.ts';

const KIGYO_DETAIL_PDF =
  'https://www.city.osaka.lg.jp/kodomo/cmsfiles/contents/0000585/585842/21_sisetu_itiran_tiikiwaku_ari.pdf';

/**
 * 企業主導型の設置者名。市のPDFの値を基本にし、PDFで語が抜けている（区の表の値がPDFの値の文字をすべて順に含む）
 * ときだけ区の表の値を使う。区の表にも誤記があるため（例:「サエンス」）、単純には区の表を優先しない
 */
function pickOperator(fromPdf: string | undefined, fromWard: string | undefined) {
  const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, '');
  if (!fromPdf || !fromWard) return fromPdf || fromWard || null;
  const [p, w] = [norm(fromPdf), norm(fromWard)];
  let i = 0;
  for (const c of w) if (c === p[i]) i++;
  return i === p.length && w.length > p.length ? fromWard : fromPdf;
}

type MatchedKigyo = KigyoDetail & { phone: string };

function withPhone(detail: KigyoDetail, phone: string): MatchedKigyo {
  return { ...detail, phone };
}

export async function buildKigyo(ward: WardConfig, input: WardInputs, warn: Warn) {
  const facilities: Facility[] = [];
  const { kigyoDetails, geocodeCache, websites, wardDetails } = input;
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
  const asOfMatch =
    decode(table.match(/<caption>([\s\S]*?)<\/caption>/)?.[1] ?? '').match(AS_OF) ?? decode(kigyoHtml).match(AS_OF);
  let kigyoAsOf = asOfMatch ? `${asOfMatch[1].replace(/\s+/g, '')}年${asOfMatch[2]}月${asOfMatch[3]}日現在` : null;
  const surveyDates = new Set<string>();
  // 区によっては表に「設置者」列がある（天王寺区）。あれば市のPDFより優先する（PDFは改行で途切れることがある）
  // 見出しは1行目のセル（施設名の列を th にしている区があるので、表全体の th は使わない）
  // 空き情報の表: ページ内の表、添付のxlsx（北区）、添付のPDF（生野区）のいずれか
  const kigyoXlsx = path.join(SRC, ward.id, 'kigyo.xlsx');
  const kigyoPdf = path.join(SRC, ward.id, 'kigyo.pdf');
  let headers: string[];
  let kigyoRows: TableCell[][];
  if (ward.kigyoFile && existsSync(kigyoXlsx)) {
    ({ headers, rows: kigyoRows } = xlsxTable(kigyoXlsx));
  } else if (ward.kigyoFile) {
    const pdfTable = await pdfTableRows(kigyoPdf, ward.kigyoPdfSection);
    headers = pdfTable.headers ?? [];
    kigyoRows = pdfTable.rows;
  } else {
    headers = (tableRows(table).find(isHeaderRow) ?? []).map((c) => c.text);
    kigyoRows = tableRows(table);
  }
  const operatorCol = headers.indexOf('設置者');
  const kigyoByAddress = (address: string): MatchedKigyo | undefined => {
    // 「靭」「靱」の異体字や、部屋番号を番地に続けて書くか（1-15-9-201）建物名の後に書くかの違いを吸収する
    const key = (s: string) =>
      s
        .normalize('NFKC')
        .replace(/^大阪市/, '')
        .replace(new RegExp(`^${ward.name}`), '')
        .replace(/靭/g, '靱')
        .replace(/[－ー―]/g, '-')
        .match(/^\D+\d+(?:-\d+)*/)?.[0];
    const entries = Object.entries(kigyoDetails);
    const prefixHits = entries.filter(([, d]) => {
      const [a, b] = [key(d.address), key(address)];
      return a && b && (a.startsWith(`${b}-`) || b.startsWith(`${a}-`));
    });
    const hit = entries.find(([, d]) => key(d.address) === key(address)) ?? (prefixHits.length === 1 ? prefixHits[0] : undefined);
    return hit && withPhone(hit[1], hit[0]);
  };
  // 表の先頭に全列を結合した表題の行がある区（住吉区）もあるので、1セルだけの行は除く
  const rows = kigyoRows.filter((cells) => cells.length > 1 && !isHeaderRow(cells));
  // 空き情報の表に所在地・電話がない区は、区の施設一覧ページの表（浪速区。2列目が所在地）か、
  // 添付の企業主導型保育事業所一覧PDF（阿倍野区。「所在地」「電話番号」列）から補う
  const infoFile = path.join(SRC, ward.id, 'kigyo_info_page.html');
  const infoPdf = path.join(SRC, ward.id, 'kigyo_info.pdf');
  let infoRows: TableCell[][] = [];
  let infoCols = [1];
  if (existsSync(infoFile)) {
    infoRows = [...(await readFile(infoFile, 'utf8')).matchAll(/<table[\s\S]*?<\/table>/g)].flatMap(([t]) => tableRows(t));
  } else if (ward.kigyoInfoFile) {
    const { headers: infoHeaders, rows: pdfInfoRows } = await pdfTableRows(infoPdf);
    if (!infoHeaders) throw new Error(`${ward.name}: kigyo_info.pdf に表がない`);
    infoRows = pdfInfoRows;
    infoCols = infoHeaders.flatMap((h, k) => (/所在地|電話/.test(h) ? [k] : []));
  } else if (!ward.kigyoFile && kigyoTables.length > 1) {
    // 空き情報の表とは別に「所在地」「連絡先」の一覧表を載せている区（西成区は空き情報の下、淀川区は上）
    infoRows = kigyoTables.filter((t) => t !== table).flatMap((t) => tableRows(t));
    infoCols = (infoRows.find(isHeaderRow) ?? []).flatMap((c, k) => (/所在地|電話|連絡先/.test(c.text) ? [k] : []));
  }
  const infoKey = (s: string) => normName(stripNoteRef(s));
  // 年齢の列の後ろに「調査日」などの列がある区（阿倍野区）は、その列を年齢から外して注記に使う
  // 見出しは「5歳」「５歳児クラス」「人数（5歳）」（都島区）など
  const lastAgeCol = headers.findIndex((h) => /(?:^|\()5歳/.test(h));
  const trailingCols = lastAgeCol > 0 ? headers.length - 1 - lastAgeCol : 0;

  for (const [idx, rowCells] of rows.entries()) {
    const cells = trailingCols ? rowCells.slice(0, -trailingCols) : rowCells;
    const surveyedOn = trailingCols
      ? rowCells
          .slice(-trailingCols)
          .map((c) => c.text)
          .find((t) => /^令和\d+年\d+月\d+日$/.test(t))
      : null;
    if (surveyedOn) surveyDates.add(surveyedOn);
    // 「備考」列（都島区）に記載があれば注記に残す
    const remarks = trailingCols
      ? rowCells
          .slice(-trailingCols)
          .map((c) => c.text)
          .filter((t) => t && t !== surveyedOn)
      : [];
    // 末尾の年齢セル（結合セルを含めて6歳分）と、その前の住所・連絡先セルに分ける
    const ageCells: TableCell[] = [];
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
    let byName: MatchedKigyo | null = null;
    if (!infoCells.length && !infoRows.length) {
      const k = infoKey(name);
      const hits = Object.entries(kigyoDetails).filter(([, d]) => {
        const dk = infoKey(d.name);
        return dk === k || (Math.min(dk.length, k.length) >= 4 && (dk.includes(k) || k.includes(dk)));
      });
      if (hits.length !== 1)
        throw new Error(`${ward.name}: 企業主導型を市の一覧と施設名で対応付けられない: ${name}（候補${hits.length}件）`);
      byName = withPhone(hits[0][1], hits[0][0]);
    } else if (!infoCells.length) {
      const info = infoRows.find((r) => r.length > 1 && infoKey(r[0].text) === infoKey(name));
      if (!info) throw new Error(`${ward.name}: 企業主導型の所在地が区の施設一覧にない: ${name}`);
      infoCells = infoCols.map((k) => info[k]);
    }

    // 「1・2歳で1人」のように年齢をまたいで結合されたセルは、どちらの年齢でも使える共有枠として扱う
    // 「調整中」は受入れ可否が未定の年齢。空きなしとは区別して注記に残す
    const vacancies: Facility['vacancies'] = [];
    let sharedVacancy: Facility['sharedVacancy'] = null;
    const pendingAges: number[] = [];
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
    const shortAddress = infoText
      .replace(phone, '')
      .replace(/[()（）]/g, '')
      .trim()
      .replace(new RegExp(`^${ward.name}`), '');
    // 電話番号で対応付け。区の表と市のPDFで電話番号が違う施設は所在地（番地まで）で対応付ける
    const byPhone = kigyoDetails[phone];
    const d = byName ?? (byPhone && withPhone(byPhone, phone)) ?? kigyoByAddress(shortAddress);
    if (!d) warn(`認可外保育施設一覧（詳細）に見つからない: ${name}`);
    else if (byName) warn(`区の表に所在地がないため、市の一覧の「${d.name}」と施設名で対応付け: ${name}`);
    else if (d.phone.startsWith('(電話番号なし)')) warn(`市の一覧に電話番号がないため所在地で対応付け: ${name}`);
    else if (!byPhone) warn(`電話番号が市の一覧（${d.phone}）と違うため所在地で対応付け: ${name} ${phone}`);
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

    facilities.push({
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
          sharedVacancy &&
            `${sharedVacancy.ages.join('・')}歳クラスの空きはあわせて${sharedVacancy.count}人です（区の一覧で結合表記）。`,
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
  return { facilities, asOf: kigyoAsOf };
}
