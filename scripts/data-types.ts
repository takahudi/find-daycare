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

export interface KigyoDetail {
  wardTag: string;
  phone: string | null;
  hours: { weekday?: string; saturday?: string; holiday?: string };
  capacity: number | null;
  monthlyUpTo: string | null;
  freeOfCharge: boolean | null;
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

export interface WardDataFiles {
  'pdf-details.json': Record<string, PdfDetail>;
  'manual-details.json': Record<string, ManualDetail>;
  'ward-details.json': Record<string, WardDetail>;
  'websites.json': Record<string, Website>;
  'kigyo-details.json': Record<string, KigyoDetail>;
  'geocode-cache.json': Record<string, GeocodePosition>;
}
