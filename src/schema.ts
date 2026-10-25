import * as v from 'valibot';

export const TextSchema = v.pipe(
  v.string('文字列が必要です'),
  v.check((s) => s.trim().length > 0, '空でない文字列が必要です'),
);
export const CountSchema = v.pipe(
  v.number('人数は数値が必要です'),
  v.integer('人数は整数が必要です'),
  v.minValue(0, '人数は0以上が必要です'),
);
export const HttpUrlSchema = v.pipe(
  TextSchema,
  v.url('有効なURLが必要です'),
  v.regex(/^https?:\/\//i, 'URLはhttpまたはhttpsが必要です'),
);
export const LatitudeSchema = v.pipe(
  v.number('緯度は数値が必要です'),
  v.minValue(-90, '緯度は-90以上が必要です'),
  v.maxValue(90, '緯度は90以下が必要です'),
);
export const LongitudeSchema = v.pipe(
  v.number('経度は数値が必要です'),
  v.minValue(-180, '経度は-180以上が必要です'),
  v.maxValue(180, '経度は180以下が必要です'),
);
export const CategorySchema = v.picklist(['nursery', 'kodomoen', 'community', 'kigyo'], '施設種別が不正です');

export const CapacitySchema = v.pipe(
  v.strictObject({
    total: CountSchema,
    // 対象年齢だけの内訳や内訳なしの資料もあるため、6件固定にはしない。
    byAge: v.pipe(v.array(CountSchema), v.maxLength(6, '定員内訳は0〜5歳の最大6件です')),
  }),
  v.check(
    (c) => c.byAge.length === 0 || c.byAge.reduce((sum, n) => sum + n, 0) === c.total,
    '定員内訳の合計が総定員と一致しません',
  ),
);

export const inOsakaCity = ({ lat, lng }: { lat: number; lng: number }) =>
  lat > 34.55 && lat < 34.8 && lng > 135.35 && lng < 135.6;

const facilityIssue = (f: { wardName: string; ward: string; id: string }, message: string) =>
  `${f.wardName} (${f.ward}) 施設 ${f.id}: ${message}`;

export const GsiHitSchema = v.object({
  properties: v.object({ title: TextSchema }),
  geometry: v.object({ coordinates: v.tuple([LongitudeSchema, LatitudeSchema]) }),
});

export const FacilitySchema = v.pipe(
  v.object({
    id: TextSchema,
    /** 区の id（scripts/wards.ts） */
    ward: TextSchema,
    wardName: TextSchema,
    name: TextSchema,
    kana: v.string('ふりがなは文字列が必要です'),
    category: CategorySchema,
    categoryLabel: TextSchema,
    detailType: v.nullable(TextSchema),
    ownership: v.nullable(TextSchema),
    operator: v.nullable(TextSchema),
    postalCode: v.nullable(TextSchema),
    address: TextSchema,
    phone: TextSchema,
    lat: LatitudeSchema,
    lng: LongitudeSchema,
    /** 0〜5歳クラスの空き人数。null はその年齢の受入れなし、0 は空きなし */
    vacancies: v.array(v.nullable(CountSchema)),
    /** 複数年齢で共有する空き枠（例: 1・2歳あわせて1人）。vacancies の該当年齢にも同じ数が入っている */
    sharedVacancy: v.nullable(v.object({ ages: v.array(v.number()), count: CountSchema })),
    /** false は認可外（企業主導型）。区役所の利用調整ではなく施設との直接契約 */
    licensed: v.boolean('認可区分は真偽値が必要です'),
    capacity: v.nullable(CapacitySchema),
    hours: v.nullable(v.object({ weekday: TextSchema, saturday: v.nullable(TextSchema), holiday: v.nullable(TextSchema) })),
    services: v.array(TextSchema),
    approvedOn: v.nullable(TextSchema),
    note: v.nullable(TextSchema),
    website: v.nullable(HttpUrlSchema),
    websiteLabel: v.nullable(TextSchema),
    infoPdfUrl: v.nullable(HttpUrlSchema),
    infoPdfLabel: v.nullable(TextSchema),
  }),
  v.rawCheck(({ dataset, addIssue }) => {
    if (!dataset.typed) return;
    const f = dataset.value;
    const issue = (message: string) => addIssue({ message: facilityIssue(f, message) });
    if (f.vacancies.length !== 6) issue('空き人数は0〜5歳の6件が必要です');
    if (!inOsakaCity(f)) issue('座標が大阪市内の範囲外です');
    if ((f.category === 'kigyo') !== !f.licensed) issue('企業主導型と認可外の対応が一致しません');
    const shared = f.sharedVacancy;
    if (shared) {
      if (
        shared.ages.length < 2 ||
        new Set(shared.ages).size !== shared.ages.length ||
        shared.ages.some((a) => !Number.isInteger(a) || a < 0 || a > 5)
      ) {
        issue('共有枠の年齢は0〜5歳の異なる2件以上が必要です');
      }
      if (shared.ages.some((a) => f.vacancies[a] !== shared.count)) issue('共有枠の人数が該当年齢の空き人数と一致しません');
    }
  }),
);

export const SourceSchema = v.object({ label: TextSchema, url: HttpUrlSchema });
export const WardSchema = v.object({
  id: TextSchema,
  name: TextSchema,
  vacancyAsOf: TextSchema,
  vacancyFor: TextSchema,
  kigyoVacancyAsOf: v.nullable(TextSchema),
  sources: v.pipe(v.array(SourceSchema), v.minLength(1, '区の出典が必要です')),
});

export const DatasetSchema = v.pipe(
  v.object({
    generatedAt: v.pipe(TextSchema, v.isoTimestamp('生成日時はISO形式が必要です')),
    wards: v.pipe(v.array(WardSchema), v.minLength(1, '区が必要です')),
    commonSources: v.pipe(v.array(SourceSchema), v.minLength(1, '共通の出典が必要です')),
    facilities: v.array(FacilitySchema),
  }),
  v.rawCheck(({ dataset, addIssue }) => {
    if (!dataset.typed) return;
    const data = dataset.value;
    const wards = new Map<string, string>();
    for (const w of data.wards) {
      if (wards.has(w.id)) addIssue({ message: `${w.name} (${w.id}): 区IDが重複しています` });
      wards.set(w.id, w.name);
      if (!data.facilities.some((f) => f.ward === w.id)) addIssue({ message: `${w.name} (${w.id}): 施設が1件もありません` });
    }
    const ids = new Set<string>();
    for (const f of data.facilities) {
      const issue = (message: string) => addIssue({ message: facilityIssue(f, message) });
      if (ids.has(f.id)) issue('施設IDが重複しています');
      ids.add(f.id);
      if (!wards.has(f.ward)) issue('区がwardsに存在しません');
      else if (wards.get(f.ward) !== f.wardName) issue('区名がwardsと一致しません');
    }
  }),
);

export const HomeSchema = v.object({ lat: LatitudeSchema, lng: LongitudeSchema, label: TextSchema });

export type Category = v.InferOutput<typeof CategorySchema>;
export type Facility = v.InferOutput<typeof FacilitySchema>;
export type Source = v.InferOutput<typeof SourceSchema>;
export type Ward = v.InferOutput<typeof WardSchema>;
export type Dataset = v.InferOutput<typeof DatasetSchema>;
export type Home = v.InferOutput<typeof HomeSchema>;
