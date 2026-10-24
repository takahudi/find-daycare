// 区役所の施設紹介資料PDF（fetch-sources.mjs が sources/<区>/homepage-sources/<n>/ に保存する）から
// 「ホームページ：」欄を抽出する。
// 出力は確認用の一覧（sources/<区>/websites.json は目視確認のうえ手で更新する）。
// Usage: node scripts/extract-ward-homepages.mjs <区のid>   例: node scripts/extract-ward-homepages.mjs tennoji
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const wardId = process.argv[2] ?? 'chuo';
const ROOT = path.resolve('sources', wardId, 'homepage-sources');
const dirs = (await readdir(ROOT, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const links = [];

for (const dir of dirs) {
  const DIR = path.join(ROOT, dir);
  if (!existsSync(DIR)) continue;
  // 区のページでのPDFのリンク文字（「アルマ保育園(PDF形式, 166.85KB)」）。平野区の様式はPDF内で施設名の位置が決まらないので、こちらを施設名にする
  const pageHtml = existsSync(path.join(ROOT, `${dir}.html`)) ? await readFile(path.join(ROOT, `${dir}.html`), 'utf8') : '';
  const pdfLabel = (f) =>
    pageHtml
      .match(new RegExp(`<a [^>]*href="[^"]*/${f.replace(/\./g, '\\.')}"[^>]*>([\\s\\S]*?)</a>`))?.[1]
      .replace(/<[^>]+>/g, '')
      .replace(/\s*[(（]PDF形式[\s\S]*$/, '')
      .trim();
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.pdf')).sort();
  for (const f of files) {
    const doc = await getDocument({ data: new Uint8Array(await readFile(path.join(DIR, f))), verbosity: 0 }).promise;
    const { items } = await (await doc.getPage(1)).getTextContent();
    const strs = items.map((i) => i.str.trim()).filter(Boolean);
    const text = strs.join('');
    // 天王寺区の様式は「〔施設名〕」の次の項目が施設名。中央区の様式は先頭が施設名
    const nameAt = strs.indexOf('〔施設名〕');
    // 平野区の様式は「URL」欄、大正区の様式は「ホームページアドレス」欄。どちらもPDF内で施設名の位置が決まらないので、区のページのリンク文字を施設名にする
    const urlAt = strs.findIndex((s) => s === 'URL' || s === 'ホームページアドレス');
    const name = nameAt >= 0 ? strs[nameAt + 1] : urlAt >= 0 && pdfLabel(f) ? pdfLabel(f) : text.slice(0, 40).split('（')[0];
    const at = text.indexOf('ホームページ');
    const hp =
      text.match(/ホームページ[：:]\s*(.*?)\s*運営主体/)?.[1] ??
      text.slice(at).match(/ホームページ[：:]\s*((?:https?:\/\/|www\.)[\x21-\x7e]+)/)?.[1] ??
      // 平野区の様式は「URL」欄。URLが「h」「ttp」「s」「://aiwafu」のように細かく分かれたり、全角文字が混じったり、
      // 欄の上の行に出たりするので、全文を半角にしてつないだ中から探す（直後の「URL」の文字は除く）
      (urlAt >= 0
        ? (strs[urlAt] === 'URL' ? text : strs.slice(urlAt + 1).join(''))
            .normalize('NFKC')
            .match(/https?:\/\/[\x21-\x7e]+/)?.[0]
            .replace(/URL$/, '')
        : null) ??
      `? ${at < 0 ? '(欄なし)' : text.slice(at, at + 60)}`;
    console.log(`${dir}/${f}\t${name}\t${hp}`);
    if (/^(?:https?:\/\/|www\.)/.test(hp))
      links.push({ file: `${dir}/${f}`, names: [name], href: hp.startsWith('www.') ? `https://${hp}` : hp });
  }
}

// 区のページ本文のリンク。「〇〇のホームページ」という文言のリンク（浪速区）か、
// 表の施設名そのものがリンクになっているもの（西区。本園・分園を1つのリンクにまとめていることがある）
for (const f of (await readdir(ROOT)).filter((f) => f.endsWith('.html')).sort()) {
  const html = await readFile(path.join(ROOT, f), 'utf8');
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map(([t]) => t).join('');
  const text = (s) =>
    s
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .trim();
  // 表の行ごとのセルの文字（リンクの文字が「ホームページ」だけの区（福島区）は、同じ行の施設名を使う）
  const rowOf = (anchor) => [...tables.matchAll(/<tr[\s\S]*?<\/tr>/g)].map(([tr]) => tr).find((tr) => tr.includes(anchor));
  for (const [all, rawHref, label] of html.matchAll(/<a [^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    // メールのリンク保護（Outlook の safelinks）を経由したURL（住吉区）は、元のURLに戻してから判定する
    const raw = rawHref.replace(/&amp;/g, '&');
    const href = (/safelinks\.protection\.outlook\.com/.test(raw) && new URL(raw).searchParams.get('url')) || raw;
    if (/city\.osaka\.lg\.jp|mapnavi|creativecommons|adobe|readspeaker/.test(href)) continue;
    let names = label
      .split(/<br\s*\/?>/)
      .map((s) => text(s).replace(/の?ホームページ$/, ''))
      .filter(Boolean);
    const row = tables.includes(all) ? rowOf(all) : null;
    if (!names.length && row)
      names = [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(([, c]) => text(c)).filter(Boolean);
    // 施設の写真がリンクになっている区（鶴見区）は、写真の代替テキストが施設名
    const alt = label.match(/<img [^>]*alt="([^"]+)"/)?.[1];
    if (!names.length && alt) names = [text(alt)];
    if (/ホームページ/.test(label) || row || alt) links.push({ file: f, names, href });
  }
}
for (const l of links) console.log(`${l.file}\t${l.names.join(' / ')}\t${l.href}`);

// --json: 生成済みの facilities.json の施設名と完全一致（空白除去）したリンクを websites.json の形で出す（目視確認用の下書き）
if (process.argv.includes('--json')) {
  const norm = (s) =>
    s
      .normalize('NFKC')
      .replace(/【[^】]*】/g, '')
      .replace(/\s+/g, '')
      .replace(/^(?:幼保連携型|幼稚園型|保育所型)?認定こども園/, '')
      .replace(/^大阪市立/, '');
  const { facilities } = JSON.parse(await readFile(path.resolve('src/data/facilities.json'), 'utf8'));
  const label = process.argv[process.argv.indexOf('--json') + 1] ?? '公式サイト';
  const out = {};
  for (const fac of facilities.filter((x) => x.ward === wardId)) {
    const hit = links.find((l) => l.names.some((n) => norm(n) === norm(fac.name)));
    // キーは build-data.mjs の normName と同じ形（「大阪市立」は残す）
    const key = fac.name
      .normalize('NFKC')
      .replace(/\s+/g, '')
      .replace(/^(?:幼保連携型|幼稚園型|保育所型)?認定こども園/, '')
      .replace(/[（(]夜間[)）]/, '');
    if (hit) out[key] = { url: hit.href, label };
    else console.error(`  リンクなし: ${fac.name}`);
  }
  console.log(JSON.stringify(out, null, 2));
}
