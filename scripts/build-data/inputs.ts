import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import { parseJson } from '../json.ts';
import type { WardDataFiles } from '../data-types.ts';
import type { CellValue } from './types.ts';
import type { WardConfig } from '../wards.ts';
import { cell } from './text.ts';

export const SRC = path.resolve('sources');
export const DATA = path.resolve('data');

const readJson = async <K extends keyof WardDataFiles>(wardId: string, name: K): Promise<WardDataFiles[K]> => {
  const file = path.join(DATA, wardId, name);
  return existsSync(file) ? parseJson(await readFile(file, 'utf8'), name) : {};
};

export async function loadWardInputs(ward: WardConfig) {
  const wb = XLSX.readFile(path.join(SRC, ward.id, 'list.xlsx'));
  const list = XLSX.utils
    .sheet_to_json<CellValue[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 })
    .filter((r) => r.length >= 7 && r[0] !== '施設種別' && r[1])
    .map(([detailType, ownership, name, postalCode, address, phone, operator]) => ({
      detailType: cell(detailType),
      ownership: cell(ownership),
      name: cell(name),
      postalCode: cell(postalCode),
      address: cell(address),
      phone: cell(phone),
      operator: cell(operator),
    }));

  const pdfDetails = await readJson(ward.id, 'pdf-details.json');
  const manualDetails = await readJson(ward.id, 'manual-details.json');
  const wardDetails = await readJson(ward.id, 'ward-details.json');
  const websites = await readJson(ward.id, 'websites.json');
  const kigyoDetails = await readJson(ward.id, 'kigyo-details.json');
  const geocodeCache = await readJson(ward.id, 'geocode-cache.json');
  const listedPdfs = new Set(await readdir(path.join(SRC, ward.id, 'facility-pdfs')));
  return { list, pdfDetails, manualDetails, wardDetails, websites, kigyoDetails, geocodeCache, listedPdfs };
}

export type WardInputs = Awaited<ReturnType<typeof loadWardInputs>>;
