import type { Facility } from '../../src/schema.ts';
import type { WardConfig } from '../wards.ts';
import type { Warn } from './types.ts';
import type { WardInputs } from './inputs.ts';
import { cell, normName, normPhone, parseShared, vacancy } from './text.ts';

// 空き情報CSVで施設情報PDFのURLが空欄の施設（施設一覧ページ上のPDFと名称で対応付け）
const PDF_FALLBACK: Record<string, string> = {
  ブライトこども園大阪谷町: 'https://www.city.osaka.lg.jp/kodomo/cmsfiles/contents/0000012/12677/h5-10-buraitotanimachi.pdf',
  谷町中央こども園: 'https://www.city.osaka.lg.jp/kodomo/cmsfiles/contents/0000012/12677/h5-18-tanimachichuo.pdf',
  なにわのみやPreSchool: 'https://www.city.osaka.lg.jp/kodomo/cmsfiles/contents/0000012/12677/h5-23-naniwanomiya.pdf',
};
const FACILITY_TYPE: Record<string, Facility['facilityType']> = {
  保育所: 'nursery',
  認定こども園: 'kodomoen',
  地域型: 'community',
};

export function buildLicensed(ward: WardConfig, wardRows: string[][], input: WardInputs, warn: Warn): Facility[] {
  const { list, pdfDetails, manualDetails, wardDetails, websites, listedPdfs } = input;
  const wardFacilities: Facility[] = [];
  const limitedRows: { id: string; name: string; vacancies: Facility['vacancies'] }[] = [];

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
    const infoUrl = [csvInfoUrl, PDF_FALLBACK[key]].find((u) => u && listedPdfs.has(u.split('/').pop()!));
    if (csvInfoUrl && !infoUrl) warn(`CSVの施設情報PDFが施設一覧ページにないため非掲載: ${name} ${csvInfoUrl}`);
    const pdfFile = infoUrl?.split('/').pop();
    const auto = pdfFile ? pdfDetails[pdfFile] : undefined;
    const manual = pdfFile ? manualDetails[pdfFile] : undefined;
    const extra = wardDetails[key];
    const detail =
      auto || manual || extra?.weekday || extra?.note
        ? { ...extra, ...auto, ...manual, note: manual?.note ?? extra?.note ?? auto?.note ?? null }
        : null;
    if (!detail?.weekday) warn(`施設の詳細情報（開所時間）なし: ${name}`);
    // ふりがな: 手動補正 > 基本情報PDF > 空き情報CSV（CSVは仮称・旧名称のままのものがある）
    const reading = (
      extra?.kana ??
      auto?.kana?.replace(/^(?:ようほれんけいがた|ようちえんがた|ほいくしょがた)?にんていこどもえん/, '') ??
      kana
    ).replace(/[\s　]+/g, '');
    const site = websites[key];
    if (!FACILITY_TYPE[category]) throw new Error(`unknown category: ${category}`);
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
      facilityType: FACILITY_TYPE[category],
      // 市の認可施設の一覧から作るので認可。施設種別との対応はスキーマで確かめる
      licensing: 'licensed',
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
      // 昼間と夜間で共有するPDFの定員は昼間の分なので、夜間保育所の行には出さない
      capacity: /夜間/.test(name) && detail?.nightHours ? null : (detail?.capacity ?? null),
      // 昼間と夜間で1つのPDFを共有する施設は、夜間保育所の行に夜間の開所時間（月〜土）を使う
      hours:
        /夜間/.test(name) && detail?.nightHours
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
          /夜間/.test(name) &&
            detail?.nightHours &&
            '開所時間は市の施設基本情報PDF（昼間の保育所と共通）の夜間の欄より。PDFに夜間の定員の記載がないため、定員は掲載していません。',
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
    const ages = l.vacancies.some((v) => v !== null && v > 0)
      ? l.vacancies.map((v) => v !== null && v > 0)
      : l.vacancies.map((v) => v !== null);
    const open = l.vacancies.map((v, age) => (ages[age] ? `${age}歳児${v}人` : null)).filter(Boolean);
    f.note = `${f.note || ''}期間限定保育の枠もあります（空き: ${open.join('・')}）。`;
  }

  return wardFacilities;
}
