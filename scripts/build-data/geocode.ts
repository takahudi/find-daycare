import * as v from 'valibot';
import { inOsakaCity } from '../../src/schema.ts';
import { gsiCandidates } from '../../src/lib/geo.ts';
import type { WardDataFiles } from '../data-schema.ts';

/** 国土地理院の住所検索で座標を求める（結果は data/<区>/geocode-cache.json に保存して再利用） */
export async function geocode(address: string, cache: WardDataFiles['geocode-cache.json']) {
  // 建物名・階数は検索の妨げになるので番地までにする
  const query = address.normalize('NFKC').match(/^.*?\d+(?:-\d+)*/)?.[0] ?? address;
  if (cache[query]) return cache[query];
  const res = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`住所検索に失敗 (${res.status}): ${query}`);
  const hits: unknown = await res.json();
  if (!v.is(v.array(v.unknown()), hits)) throw new Error(`住所検索の応答形式が不正: ${query}`);
  // 先頭の結果だけを見る。後ろの候補は別の町への近似結果のことがある
  const [hit] = gsiCandidates(hits.slice(0, 1));
  if (!hit || /[区市]$/.test(hit.label)) throw new Error(`住所検索で町名まで一致しない: ${query}`);
  if (!inOsakaCity(hit)) throw new Error(`住所検索の結果が大阪市外です: ${query}`);
  cache[query] = hit;
  return cache[query];
}
