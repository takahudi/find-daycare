import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Facility } from '../../src/types.ts';
import type { WardConfig } from '../wards.ts';
import type { Warn } from '../data-types.ts';
import { SRC } from './inputs.ts';
import { decode, tableRows, isHeaderRow } from './html.ts';
import { xlsxTable } from './xlsx.ts';
import { pdfTableRows } from './pdf.ts';
import { stripNoteRef, vacancy } from './text.ts';

// 区の空き情報とCSVで名前の書き方がまったく違う施設（区の表の名前 → CSVの名前。空白除去）
const WARD_ROW_ALIASES: Record<string, string> = {
  '俊英舘保育園・こぐま分園': '俊英舘保育園分園こぐま園',
  // 西淀川区の表は保育所部分（光の園たんぽぽ保育園）と認定こども園の名前を並べて書いている
  '光の園たんぽぽ保育園光の園幼稚園(2・3号認定)': '光の園幼稚園',
  // 淀川区の空き情報は認定こども園への移行前の名前のまま（区の施設一覧では「まことよどがわこども園」、所在地は同じ）
  まことよどがわ保育園: 'まことよどがわこども園',
  // 港区の表は「保育所」を付けて書いている
  日輪学園保育所: '日輪学園',
};

export async function reconcileVacancies(ward: WardConfig, wardFacilities: Facility[], warn: Warn) {
  // 区によって xlsx（東成区）またはページ本文の表（天王寺区）で公表している。PDFのみの区（中央区）は目視で照合する
  // 「第2」と「第二」の表記ゆれ（生野区の表とCSV）や「・」の有無（鶴見区「えがおの森保育園・つるみ」）、括弧の種類も同じ名前として扱う
  // 「(夜間)」は外さない（北区の大淀保育所は昼間と夜間で別の行・別の施設）
  const stripCity = (s: string) =>
    s
      .normalize('NFKC')
      .replace(/[\s・]+/g, '')
      // 「えーむ」と『えーむ』（住之江区の表とCSV）も同じ名前として扱う
      .replace(/『/g, '「')
      .replace(/』/g, '」')
      .replace(/^(?:幼保連携型|幼稚園型|保育所型)?認定こども園/, '')
      .replace(/^大阪市立/, '')
      .replace(/第([一二三四五六七八九])/g, (_: string, k: string) => `第${'一二三四五六七八九'.indexOf(k) + 1}`);
  const wardRowsToCheck: { names: string[]; vals: string[] }[] = [];
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
      let cells = row.flatMap((c) => [c.text, ...Array<string>(c.span - 1).fill('')]);
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
    for (const r of await pdfTableRows(vacancyPdf))
      wardRowsToCheck.push({ names: [r[0].text], vals: r.slice(-6).map((c) => c.text) });
  }
  if (wardRowsToCheck.length) console.log(`[${ward.name}] 区の空き情報 ${wardRowsToCheck.length} 施設とCSVを照合`);
  // 「Four Leaf (フォーリーフ)」のように末尾に読みを添えた名前は、読みを外した形でも探す
  // 「育（はぐくみ）福島本園」のように途中に読みが入る名前は、読みを外した形でも探す
  // 「のぎく保育園(分園）」とCSVの「のぎく保育園 分園」（鶴見区）のように、末尾の括弧だけが違う名前は括弧を外した形でも探す
  const rowKeys = (names: string[]) =>
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
        .filter((m): m is RegExpMatchArray => Boolean(m))
        .map(([, base, paren]) =>
          wardFacilities.find((x) => stripCity(x.name).startsWith(base) && stripCity(x.name).endsWith(paren)),
        )
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
    let noteShared: Facility['sharedVacancy'] = null;
    if (ref) {
      const m = decode(pageHtml)
        .normalize('NFKC')
        .match(new RegExp(`\\(注${ref}\\)\\s*([0-5])歳児クラス及び([0-5])歳児クラスで、(\\d+)名まで`));
      if (!m) throw new Error(`${ward.name}: 区の空き情報の注記（注${ref}）を読めない: ${f.name}`);
      noteShared = { ages: noteRefs.flatMap((r, age) => (r === ref ? [age] : [])), count: Number(m[3]) };
    }
    // 「空欄」（東淀川区の空きなし）は0。ただしCSVで受入れのないクラスは、区のxlsでも空欄になっていることがある（小松保育園の3〜5歳。基本情報PDFの定員も0人）ので受入れなしのまま
    const expected = vals.map((v, age) =>
      noteShared?.ages.includes(age)
        ? noteShared.count
        : v === '空欄'
          ? f.vacancies[age] === null
            ? null
            : 0
          : v === '調整中'
            ? null
            : vacancy(v),
    );
    // 本園と分園を1行にまとめて公表する区がある（西区）。CSVでは別行なので、分園と合算して比べる
    // （分園にも区の表の行がある区では合算しない）
    const branches = wardFacilities.filter(
      (x) =>
        x !== f && /分園/.test(x.name) && stripCity(x.name).startsWith(stripCity(f.name)) && !allWardKeys.has(stripCity(x.name)),
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
    const differs = (v: number | null, i: number) => v !== f.vacancies[i] && !(v === null && f.vacancies[i] === 0);
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
}
