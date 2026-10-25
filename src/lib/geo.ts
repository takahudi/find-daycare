import * as v from 'valibot';
import { GsiHitSchema, inOsakaCity, type Home } from '../schema';

/** 2点間の直線距離（メートル） */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371e3;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10}m` : `${(m / 1000).toFixed(1)}km`;
}

/** 不動産表示規約の目安（徒歩 80m/分）。直線距離ベースなので実際の道のりより短めに出る */
export const walkMinutes = (m: number) => Math.max(1, Math.ceil(m / 80));

const KANJI_DIGITS = '〇一二三四五六七八九';
const kanjiNumber = (s: string) =>
  s.includes('十')
    ? (s.startsWith('十') ? 1 : KANJI_DIGITS.indexOf(s[0])) * 10 + (s.endsWith('十') ? 0 : KANJI_DIGITS.indexOf(s.slice(-1)))
    : Number(Array.from(s, (c) => KANJI_DIGITS.indexOf(c)).join(''));

/** 住所の区より後ろを「町名」と最初の数字（丁目、丁目のない町は番地）に分ける。例:「中之島一丁目3番」→ 中之島 / 1 */
function splitTown(address: string): { town: string; num: number | null } {
  const rest = address
    .normalize('NFKC')
    .replace(/^.*?区/, '')
    .replace(/^.*?市/, '')
    .trim();
  const m = rest.match(/^(.+?)(?:([一二三四五六七八九十]+)丁目|(\d+))/);
  if (!m) return { town: rest.replace(/丁目$/, ''), num: null };
  return { town: m[1], num: m[2] ? kanjiNumber(m[2]) : Number(m[3]) };
}

/**
 * 国土地理院「住所検索API」で住所を緯度経度に変換する。
 * 「中央区」「本町」などは全国に同名があるため、大阪市内の候補を優先する。
 * 町名だけ入力された場合は、対象の区（wardNames）それぞれに付けて検索し、
 * 町名と丁目（番地）の数字まで一致する結果を採用する。
 */
export async function geocode(query: string, wardNames: string[], signal?: AbortSignal): Promise<Home> {
  const q = query.trim().normalize('NFKC');
  // 町名だけの入力は区名を付けないと検索に掛からない（「大阪市〇〇町6丁目」は市レベルの結果しか返らない）
  const candidates = /大阪/.test(q) ? [q] : /^\D+?区/.test(q) ? [`大阪市${q}`] : [...wardNames.map((w) => `大阪市${w}${q}`), q];
  const input = splitTown(q);
  // 区の数だけ順に問い合わせると遅いので並列に投げ、結果は候補の順（対象の区の並び）で選ぶ
  const results = await Promise.all(
    candidates.map(async (c) => {
      const res = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(c)}`, { signal });
      if (!res.ok) throw new Error(`住所検索に失敗しました（HTTP ${res.status}）`);
      const result = v.safeParse(v.array(v.unknown()), await res.json());
      if (!result.success) throw new Error('住所検索の応答形式が不正です。住所検索サービスの対応が必要です。');
      const features = result.output.filter((hit) => v.is(GsiHitSchema, hit));
      // 「大阪府大阪市中央区」のような区レベルの結果や、その区にない町名を投げると
      // 同じ区の別の町への近似結果が返るので、町名で確かめる
      return features
        .map((f) => ({ lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], label: f.properties.title }))
        .filter((h) => inOsakaCity(h) && !/[区市]$/.test(h.label) && h.label.includes(input.town));
    }),
  );
  // 別の区の候補を引くと「〇〇町西」のような前方一致の町が返るので、町名・数字が完全に一致する結果を優先する
  const exact = results.flat().find((h) => {
    const t = splitTown(h.label);
    return t.town === input.town && (input.num === null || t.num === input.num);
  });
  const partial = exact ?? results.flat()[0];
  if (partial) return partial;
  throw new Error('大阪市内で該当する住所が見つかりませんでした。町名・丁目まで入力してください。');
}
