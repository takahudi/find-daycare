// websites.json の URL が開けるか確認する（リンク切れの検出用）。
// Usage: node scripts/check-urls.mjs <区のid>
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const wardId = process.argv[2] ?? 'chuo';
const sites = JSON.parse(await readFile(path.resolve('sources', wardId, 'websites.json'), 'utf8'));
const entries = Object.entries(sites).filter(([k, v]) => !k.startsWith('_') && v.url);

await Promise.all(
  entries.map(async ([name, { url }]) => {
    try {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'Mozilla/5.0' } });
      const title = (await res.text()).match(/<title[^>]*>([^<]*)/i)?.[1]?.trim().slice(0, 50) ?? '';
      console.log(`${res.status}\t${name}\t${url}${res.url !== url ? ` -> ${res.url}` : ''}\t${title}`);
    } catch (e) {
      console.log(`ERR\t${name}\t${url}\t${e.cause?.code ?? e.message}`);
    }
  }),
);
