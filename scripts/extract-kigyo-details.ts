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
import { parsePage, toPositionedTexts } from './kigyo-pdf.ts';
import type { KigyoDetail } from './data-schema.ts';

const PDF = path.resolve('sources/city/ninkagai_detail.pdf');

const doc = await getDocument({ data: new Uint8Array(await readFile(PDF)), verbosity: 0 }).promise;
const outputs: { ward: (typeof WARDS)[number]; out: Record<string, KigyoDetail> }[] = WARDS.map((ward) => ({ ward, out: {} }));
const outByTag = new Map(outputs.map(({ ward, out }) => [ward.ninkagaiTag, out]));
for (let p = 1; p <= doc.numPages; p++) {
  const tokens = toPositionedTexts(await pageTextItems(await doc.getPage(p)));
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

for (const { ward, out } of outputs) {
  try {
    validateJson('kigyo-details.json', out);
  } catch (error) {
    throw new Error(`${ward.name}: 抽出結果の検証に失敗しました`, { cause: error });
  }
}
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
