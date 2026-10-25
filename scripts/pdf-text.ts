import type { PDFPageProxy, TextItem } from 'pdfjs-dist/types/src/display/api.js';

export interface PositionedText {
  s: string;
  x: number;
  y: number;
}

export async function pageTextItems(page: PDFPageProxy): Promise<TextItem[]> {
  return (await page.getTextContent()).items.filter((item): item is TextItem => 'str' in item);
}
