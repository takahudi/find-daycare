import type { Facility, Ward } from '../../src/schema.ts';
import type { WardConfig } from '../wards.ts';
import type { Warn } from './types.ts';
import type { WardInputs } from './inputs.ts';
import { normName } from './text.ts';

export function getVacancyDates(asOfMonth: number, admissionMonth: number, snapshot: string) {
  // CSV には年がないため、端末の時計ではなく一次情報の取得日に最も近い年を選ぶ。
  const snapshotYear = Number(snapshot.slice(0, 4));
  const monthDifference = asOfMonth - Number(snapshot.slice(5, 7));
  const asOfYear = snapshotYear + (monthDifference > 6 ? -1 : monthDifference < -6 ? 1 : 0);
  const admissionYear = asOfYear + (admissionMonth < asOfMonth ? 1 : 0);
  return {
    vacancyAsOf: `令和${asOfYear - 2018}年${asOfMonth}月1日現在`,
    vacancyFor: `${admissionMonth}月1日入所用`,
    admissionDate: `${admissionYear}-${String(admissionMonth).padStart(2, '0')}-01`,
  };
}

export function finishWard(
  ward: WardConfig,
  wardRows: string[][],
  wardFacilities: Facility[],
  input: WardInputs,
  kigyoAsOf: string | null,
  warn: Warn,
  snapshot: string,
): Ward {
  const { wardDetails, websites } = input;
  const ids = wardFacilities.map((f) => f.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`${ward.name}: 施設IDが重複: ${dup}`);

  // 補完ファイルのキーの打ち間違い検出
  // 施設名を直したもの（ward-details.json の name）は、CSVの名前のキーで書いている
  const renamedKeys = Object.entries(wardDetails).flatMap(([k, d]) =>
    d.name && wardFacilities.some((f) => f.name === d.name) ? [k] : [],
  );
  const knownKeys = new Set([...wardFacilities.map((f) => normName(f.name)), ...renamedKeys]);
  for (const file of [websites, wardDetails]) {
    for (const k of Object.keys(file)) {
      if (!knownKeys.has(k)) warn(`対応する施設がないキー: ${k}`);
    }
  }

  return {
    id: ward.id,
    snapshot,
    name: ward.name,
    ...getVacancyDates(Number(wardRows[0][16]), Number(wardRows[0][20]), snapshot),
    kigyoVacancyAsOf: kigyoAsOf,
    sources: [
      { label: `${ward.name}役所「保育施設等の空き状況」`, url: ward.vacancyPage },
      { label: `大阪市「保育施設等一覧（${ward.name}）」（施設種別・運営法人・各施設基本情報PDF）`, url: ward.listPage },
      ...ward.homepageSources.map((s) => ({ label: `${ward.name}役所「${s.label}」（各施設のホームページ）`, url: s.url })),
      { label: `${ward.name}役所「企業主導型保育事業所の空き情報」（企業主導型の空き人数【地域枠】）`, url: ward.kigyoPage },
      ...(ward.kigyoInfoPage
        ? [{ label: `${ward.name}役所の施設一覧（企業主導型の所在地・位置）`, url: ward.kigyoInfoPage }]
        : []),
    ],
  };
}
