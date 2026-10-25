import type { Facility, Ward } from '../../src/schema.ts';
import type { WardConfig } from '../wards.ts';
import type { Warn } from './types.ts';
import type { WardInputs } from './inputs.ts';
import { normName } from './text.ts';

export function finishWard(
  ward: WardConfig,
  wardRows: string[][],
  wardFacilities: Facility[],
  input: WardInputs,
  kigyoAsOf: string | null,
  now: Date,
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

  // CSV には月しかないので、年はビルド日から推定する（12月に翌年1月分を取り込むケースも考慮）
  const reiwa = (month: number) => (month > now.getMonth() + 2 ? now.getFullYear() - 1 : now.getFullYear()) - 2018;
  const asOfMonth = Number(wardRows[0][16]);
  return {
    id: ward.id,
    snapshot,
    name: ward.name,
    vacancyAsOf: `令和${reiwa(asOfMonth)}年${asOfMonth}月1日現在`,
    vacancyFor: `${Number(wardRows[0][20])}月1日入所用`,
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
