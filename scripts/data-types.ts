import type { Facility } from '../src/types.ts';

export interface PdfDetail {
  kana: string | null;
  capacity: Facility['capacity'];
  weekday: string | null;
  saturday: string | null;
  nightHours?: string;
  services: string[];
  url: string | null;
  approvedOn: string | null;
  note?: string;
}

export type ManualDetail = Omit<PdfDetail, 'kana'>;
export interface WardDetail {
  name?: string;
  kana?: string;
  weekday?: string;
  saturday?: string;
  capacity?: Facility['capacity'];
  services?: string[];
  note?: string;
}

export interface Website {
  url: string | null;
  label: string;
}

export interface KigyoBlock {
  wardTag: string;
  phone: string | null;
  hours: { weekday?: string; saturday?: string; holiday?: string };
  capacity: number | null;
  monthlyUpTo: string | null;
  freeOfCharge: boolean | null;
  name?: string;
  type?: string;
  postalCode?: string;
  address?: string;
  startedOn?: string;
  operator?: string;
}

export interface KigyoDetail extends KigyoBlock {
  name: string;
  type: string;
  postalCode: string;
  address: string;
  startedOn: string;
  operator: string;
  page: number;
}

export interface GeocodePosition {
  lat: number;
  lng: number;
  label: string;
}

// _ で始まるキーは施設のデータではなく、手作業の出典や補正理由を記した文字列。
export type AnnotatedRecords<T> = Record<string, T> & { [key: `_${string}`]: string };

export interface WardDataFiles {
  'pdf-details.json': Record<string, PdfDetail>;
  'manual-details.json': AnnotatedRecords<ManualDetail>;
  'ward-details.json': AnnotatedRecords<WardDetail>;
  'websites.json': AnnotatedRecords<Website>;
  'kigyo-details.json': Record<string, KigyoDetail>;
  'geocode-cache.json': Record<string, GeocodePosition>;
}

export interface PositionedText {
  s: string;
  x: number;
  y: number;
}

export interface TableCell {
  span: number;
  html: string;
  text: string;
}

export type PdfTable = TableCell[][] & { header?: string[] };
export type Warn = (message: string) => void;

export type CellValue = string | number | boolean | null | undefined;
