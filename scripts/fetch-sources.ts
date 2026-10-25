// 一次情報（大阪市・各区役所の公開ファイル）を sources/ に取得し直す。
// 空き情報は毎月更新されるので、更新時は `pnpm data:update` を実行する。
// Usage: node scripts/fetch-sources.ts [区のid ...]
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CITY_SOURCES, WARDS } from './wards.ts';

const SRC = path.resolve('sources');

async function download(url: string, file: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  console.log(`  ${path.relative(process.cwd(), file)}`);
}

/** ページ内の ./cmsfiles/... へのリンクを絶対URLにして返す（市のCMSは /<部署>/cmsfiles/ 配下に置く） */
async function listFiles(pageUrl: string, ext: string) {
  const html = await (await fetch(pageUrl)).text();
  const { origin, pathname } = new URL(pageUrl);
  const dept = pathname.split('/')[1];
  const re = new RegExp(`href="\\./(cmsfiles/[^"]+\\.${ext})"`, 'g');
  return [...new Set([...html.matchAll(re)].map((m) => `${origin}/${dept}/${m[1]}`))];
}

console.log('大阪市「保育施設等 空き情報マップ」のデータ（全市）');
await download(CITY_SOURCES.vacancyCsv, path.join(SRC, 'sukusukudata.csv'));

console.log('大阪市「地域の児童が利用できる認可外保育施設一覧（詳細）」');
for (const url of await listFiles(CITY_SOURCES.ninkagaiPage, 'pdf')) await download(url, path.join(SRC, 'ninkagai_detail.pdf'));

// 区の id を引数に渡すとその区だけ取得する（区を追加するとき用）。市全体のファイルは常に取得する
const only = process.argv.slice(2);
for (const ward of WARDS.filter((w) => !only.length || only.includes(w.id))) {
  const dir = path.join(SRC, ward.id);
  console.log(`\n== ${ward.name}`);

  console.log('区役所「保育施設等の空き状況」（照合用）');
  if (ward.vacancyFile) {
    const vacancyUrl = (await listFiles(ward.vacancyPage, '(?:pdf|xlsx?)')).find((u) => ward.vacancyFile!.test(u));
    if (!vacancyUrl) throw new Error(`${ward.name}: 空き情報ファイルが見つからない（wards.ts の vacancyFile を確認）`);
    await download(vacancyUrl, path.join(dir, `vacancy${path.extname(vacancyUrl)}`));
  }
  // ページ本文にも空き人数の表を載せている区がある（天王寺区・浪速区など）。あればビルド時の照合に使う
  await download(ward.vacancyPage, path.join(dir, 'vacancy_page.html'));

  console.log('大阪市「保育施設等一覧」と各施設の基本情報PDF');
  for (const url of await listFiles(ward.listPage, 'xlsx')) await download(url, path.join(dir, 'list.xlsx'));
  for (const url of await listFiles(ward.listPage, 'pdf')) {
    const name = url.split('/').pop()!;
    // 区の一覧PDF（"5.pdf" "14.pdf" のように数字だけのファイル名）と施設ごとのPDFを分ける
    await download(url, /^\d+\.pdf$/.test(name) ? path.join(dir, 'list.pdf') : path.join(dir, 'facility-pdfs', name));
  }

  console.log('区役所「企業主導型保育事業所の空き情報」（ページ内の表を使う）');
  await download(ward.kigyoPage, path.join(dir, 'kigyo_page.html'));
  if (ward.kigyoInfoPage) await download(ward.kigyoInfoPage, path.join(dir, 'kigyo_info_page.html'));
  if (ward.kigyoInfoFile) {
    const infoUrl = (await listFiles(ward.kigyoPage, 'pdf')).find((u) => ward.kigyoInfoFile!.test(u));
    if (!infoUrl) throw new Error(`${ward.name}: 企業主導型の一覧PDFが見つからない（wards.ts の kigyoInfoFile を確認）`);
    await download(infoUrl, path.join(dir, 'kigyo_info.pdf'));
  }
  if (ward.kigyoFile) {
    const kigyoUrl = (await listFiles(ward.kigyoPage, '(?:pdf|xlsx)')).find((u) => ward.kigyoFile!.test(u));
    if (!kigyoUrl) throw new Error(`${ward.name}: 企業主導型の空き情報ファイルが見つからない（wards.ts の kigyoFile を確認）`);
    await download(kigyoUrl, path.join(dir, `kigyo${path.extname(kigyoUrl)}`));
  }

  console.log('各施設のホームページが載っている区の資料');
  for (const [i, src] of ward.homepageSources.entries()) {
    await download(src.url, path.join(dir, 'homepage-sources', `${i + 1}.html`));
    for (const url of await listFiles(src.url, 'pdf')) {
      await download(url, path.join(dir, 'homepage-sources', `${i + 1}`, url.split('/').pop()!));
    }
  }
}
