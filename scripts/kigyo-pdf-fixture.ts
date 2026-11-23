// 認可外保育施設一覧（詳細）PDFの指定ページのテキストを、kigyo-pdf.test.ts の固定入力として書き出す。
// 座標は小数第2位に丸める（kigyo-pdf.ts の位置の許容幅は 2pt 以上）。
// Usage: node scripts/kigyo-pdf-fixture.ts <page> [<page> ...]
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pageTextItems } from './pdf-text.ts';
import { toPositionedTexts } from './kigyo-pdf.ts';
import { readManifest } from './snapshots.ts';

const FIXTURE = path.resolve('scripts/fixtures/ninkagai-detail-pages.json');

const pages = process.argv.slice(2).map(Number);
if (!pages.length || pages.some((p) => !Number.isInteger(p) || p < 1)) throw new Error('ページ番号を1つ以上指定してください');
const { fetchedOn } = await readManifest('city');
const doc = await getDocument({
  data: new Uint8Array(await readFile(path.resolve('sources/city/ninkagai_detail.pdf'))),
  verbosity: 0,
}).promise;
const round = (n: number) => Math.round(n * 100) / 100;
const lines: string[] = [];
for (const p of pages) {
  const tokens = toPositionedTexts(await pageTextItems(await doc.getPage(p)));
  lines.push(`    "${p}": [\n${tokens.map((t) => `      ${JSON.stringify([t.s, round(t.x), round(t.y)])}`).join(',\n')}\n    ]`);
}
await writeFile(FIXTURE, `{\n  "fetchedOn": "${fetchedOn}",\n  "pages": {\n${lines.join(',\n')}\n  }\n}\n`);
console.log(`wrote ${pages.length} pages -> ${path.relative(process.cwd(), FIXTURE)}`);
