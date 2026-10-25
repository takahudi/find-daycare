import { parseJson } from '../json.ts';
import type { WardDataFiles } from '../data-types.ts';

/** 国土地理院の住所検索で座標を求める（結果は data/<区>/geocode-cache.json に保存して再利用） */
export async function geocode(address: string, cache: WardDataFiles['geocode-cache.json']) {
  // 建物名・階数は検索の妨げになるので番地までにする
  const query = address.normalize('NFKC').match(/^.*?\d+(?:-\d+)*/)?.[0] ?? address;
  if (cache[query]) return cache[query];
  const res = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`住所検索に失敗 (${res.status}): ${query}`);
  const [hit] = parseJson(await res.text(), 'geocode-response');
  if (!hit || /[区市]$/.test(hit.properties.title)) throw new Error(`住所検索で町名まで一致しない: ${query}`);
  cache[query] = { lat: hit.geometry.coordinates[1], lng: hit.geometry.coordinates[0], label: hit.properties.title };
  return cache[query];
}
