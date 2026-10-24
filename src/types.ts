export type Category = 'nursery' | 'kodomoen' | 'community' | 'kigyo';

export interface Facility {
  id: string;
  /** 区の id（scripts/wards.mjs） */
  ward: string;
  wardName: string;
  name: string;
  kana: string;
  category: Category;
  categoryLabel: string;
  detailType: string | null;
  ownership: string | null;
  operator: string | null;
  postalCode: string | null;
  address: string;
  phone: string;
  lat: number;
  lng: number;
  /** 0〜5歳クラスの空き人数。null はその年齢の受入れなし */
  vacancies: (number | null)[];
  /** 複数年齢で共有する空き枠（例: 1・2歳あわせて1人）。vacancies の該当年齢にも同じ数が入っている */
  sharedVacancy: { ages: number[]; count: number } | null;
  /** false は認可外（企業主導型）。区役所の利用調整ではなく施設との直接契約 */
  licensed: boolean;
  capacity: { total: number; byAge: number[] } | null;
  hours: { weekday: string; saturday: string | null; holiday: string | null } | null;
  services: string[];
  approvedOn: string | null;
  note: string | null;
  website: string | null;
  websiteLabel: string | null;
  infoPdfUrl: string | null;
  infoPdfLabel: string | null;
}

export interface Source {
  label: string;
  url: string;
}

export interface Ward {
  id: string;
  name: string;
  vacancyAsOf: string;
  vacancyFor: string;
  kigyoVacancyAsOf: string | null;
  sources: Source[];
}

export interface Dataset {
  generatedAt: string;
  wards: Ward[];
  commonSources: Source[];
  facilities: Facility[];
}

export interface Home {
  lat: number;
  lng: number;
  label: string;
}
