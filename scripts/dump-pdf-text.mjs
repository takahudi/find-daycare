// Debug helper: dump positioned text items of the first pages of a PDF.
// Usage: node scripts/dump-pdf-text.mjs <pdf> [maxPages]
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const [file, maxPages = '2'] = process.argv.slice(2);
const doc = await getDocument({ data: new Uint8Array(await readFile(file)), verbosity: 0 }).promise;
for (let p = 1; p <= Math.min(doc.numPages, Number(maxPages)); p++) {
  const page = await doc.getPage(p);
  const { items } = await page.getTextContent();
  console.log(`--- page ${p}`);
  for (const it of items) {
    if (!it.str.trim()) continue;
    console.log(`${Math.round(it.transform[4])}\t${Math.round(it.transform[5])}\t${it.str}`);
  }
}
