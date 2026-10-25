// websites.json の URL が開けるか確認する（リンク切れの検出用）。
// Usage: node scripts/check-urls.ts <区のid>
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseJson } from './json.ts';

const wardId = process.argv[2] ?? 'chuo';
const sites = parseJson(await readFile(path.resolve('data', wardId, 'websites.json'), 'utf8'), 'websites.json');
const entries = Object.entries(sites).filter(([, v]) => v.url);

await Promise.all(
  entries.map(async ([name, { url }]) => {
    try {
      const res = await fetch(url!, {
        redirect: 'follow',
        signal: AbortSignal.timeout(20000),
        headers: { 'user-agent': 'Mozilla/5.0' },
      });
      const title =
        (await res.text())
          .match(/<title[^>]*>([^<]*)/i)?.[1]
          ?.trim()
          .slice(0, 50) ?? '';
      console.log(`${res.status}\t${name}\t${url}${res.url !== url ? ` -> ${res.url}` : ''}\t${title}`);
    } catch (e: unknown) {
      const error = e !== null && (typeof e === 'object' || typeof e === 'function') ? e : {};
      const cause = 'cause' in error ? error.cause : undefined;
      const code =
        cause !== null && (typeof cause === 'object' || typeof cause === 'function') && 'code' in cause ? cause.code : undefined;
      const message = 'message' in error ? error.message : undefined;
      console.log(`ERR\t${name}\t${url}\t${String(code ?? message)}`);
    }
  }),
);
