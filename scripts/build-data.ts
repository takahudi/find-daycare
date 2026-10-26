// 一次情報（大阪市・各区役所の公開データ）から、アプリが読む src/data/facilities.json を生成する。
// 対象の区と取得元は scripts/wards.ts を参照。
//
// 入力（一次情報は sources/、手で整えた JSON と抽出結果は data/）
//   sources/city/sukusukudata.csv           大阪市「保育施設等 空き情報マップ」のデータ（全市。緯度経度・年齢別空き人数）
//   sources/<区>/list.xlsx             大阪市「保育施設等一覧（区別）」（施設種別・設置運営・郵便番号・運営法人）
//   sources/<区>/vacancy.xlsx|xls|pdf  区役所の空き情報（xlsx・xls の区は CSV と自動照合する）
//   sources/<区>/kigyo_page.html       区役所「企業主導型保育事業所の空き情報」ページ
//   data/<区>/pdf-details.json         各施設「基本情報」PDFからの抽出結果（extract-pdf-details.ts）
//   data/<区>/manual-details.json      自動抽出できない様式のPDFを目視転記したもの
//   data/<区>/ward-details.json        区の資料からの補完・ふりがな補正
//   data/<区>/websites.json            各施設の公式ホームページURL
//   data/<区>/kigyo-details.json       認可外保育施設一覧（詳細）PDFからの抽出結果（extract-kigyo-details.ts）
//   data/<区>/geocode-cache.json       企業主導型で座標が公開されていない施設の住所検索結果（国土地理院）
//
// Usage: node scripts/build-data.ts
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { writeJson } from './json.ts';
import type { Dataset, Facility, Ward } from '../src/schema.ts';
import { CITY_SOURCES, WARDS } from './wards.ts';
import { parseCsv } from './build-data/csv.ts';
import { SRC, loadWardInputs, saveGeocodeCache } from './build-data/inputs.ts';
import { buildLicensed } from './build-data/licensed.ts';
import { reconcileVacancies } from './build-data/reconcile.ts';
import { buildKigyo } from './build-data/kigyo.ts';
import { loadVerifiedSnapshots, SNAPSHOT_IDS } from './snapshots.ts';
import { finishWard } from './build-data/ward.ts';

const OUT = path.resolve('src/data/facilities.json');
const snapshots = await loadVerifiedSnapshots(SNAPSHOT_IDS);
const csv = parseCsv((await readFile(path.join(SRC, 'city', 'sukusukudata.csv'), 'utf8')).replace(/^﻿/, ''));
const [, ...csvRows] = csv;
const now = new Date();
const warnings: string[] = [];
const facilities: Facility[] = [];
const wards: Ward[] = [];

for (const ward of WARDS) {
  const warn = (msg: string) => warnings.push(`[${ward.name}] ${msg}`);
  const wardRows = csvRows.filter((r) => r[6] === ward.name);
  if (!wardRows.length) throw new Error(`${ward.name}: 空き情報CSVに該当行がない`);
  const input = await loadWardInputs(ward);
  const licensed = buildLicensed(ward, wardRows, input, warn);
  await reconcileVacancies(ward, licensed, warn);
  const { facilities: kigyo, asOf: kigyoAsOf } = await buildKigyo(ward, input, warn);
  if (Object.keys(input.geocodeCache).length) {
    await saveGeocodeCache(ward.id, input.geocodeCache);
  }
  const wardFacilities = [...licensed, ...kigyo];
  wards.push(finishWard(ward, wardRows, wardFacilities, input, kigyoAsOf, now, warn, snapshots[ward.id].fetchedOn));
  facilities.push(...wardFacilities);
}

const data: Dataset = {
  generatedAt: now.toISOString(),
  citySnapshot: snapshots.city.fetchedOn,
  wards,
  commonSources: [
    { label: '大阪市「保育施設等 空き情報マップ」（位置情報・空き人数データ）', url: CITY_SOURCES.vacancyMap },
    {
      label: '大阪市「地域の児童が利用できる認可外保育施設一覧」（企業主導型の開所時間・定員・設置者）',
      url: CITY_SOURCES.ninkagaiPage,
    },
  ],
  facilities,
};

await mkdir(path.dirname(OUT), { recursive: true });
await writeJson('facilities.json', OUT, data);
console.log(
  `wrote ${facilities.length} facilities -> ${path.relative(process.cwd(), OUT)}  (${wards
    .map((w) => `${w.name} ${facilities.filter((f) => f.ward === w.id).length}`)
    .join(', ')})`,
);
for (const w of warnings) console.warn(`  ! ${w}`);
