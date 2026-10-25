// 一次情報（大阪市・各区役所の公開ファイル）を sources/ に取得し直す。
// 空き情報は毎月更新されるので、更新時は `pnpm data:update` を実行する。
// Usage: node scripts/fetch-sources.ts [区のid ...]
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fetchSnapshot, selectIds } from './snapshots.ts';
import { CITY_SOURCES, WARDS } from './wards.ts';

const SRC = path.resolve('sources');

async function downloadFile(url: string, file: string, display = file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  console.log(`  ${path.relative(process.cwd(), display)}`);
}

/** ページ内の ./cmsfiles/... へのリンクを絶対URLにして返す（市のCMSは /<部署>/cmsfiles/ 配下に置く） */
async function listFiles(pageUrl: string, ext: string) {
  const response = await fetch(pageUrl);
  if (!response.ok) throw new Error(`${response.status} ${pageUrl}`);
  const html = await response.text();
  const { origin, pathname } = new URL(pageUrl);
  const dept = pathname.split('/')[1];
  const re = new RegExp(`href="\\./(cmsfiles/[^"]+\\.${ext})"`, 'g');
  return [...new Set([...html.matchAll(re)].map((m) => `${origin}/${dept}/${m[1]}`))];
}

const only = process.argv.slice(2);
selectIds(only);
await fetchSnapshot('city', async (dir) => {
  const download = (url: string, file: string) => downloadFile(url, file, path.join(SRC, 'city', path.relative(dir, file)));
  console.log('大阪市「保育施設等 空き情報マップ」のデータ（全市）');
  await download(CITY_SOURCES.vacancyCsv, path.join(dir, 'sukusukudata.csv'));
  console.log('大阪市「地域の児童が利用できる認可外保育施設一覧（詳細）」');
  const urls = await listFiles(CITY_SOURCES.ninkagaiPage, 'pdf');
  if (!urls.length) throw new Error('市の認可外保育施設一覧PDFが見つかりません');
  for (const url of urls) await download(url, path.join(dir, 'ninkagai_detail.pdf'));
});

// 区を指定したときも、照合に使う全市共通の一次情報は取得する。
for (const ward of WARDS.filter((w) => !only.length || only.includes(w.id))) {
  await fetchSnapshot(ward.id, async (dir) => {
    const download = (url: string, file: string) => downloadFile(url, file, path.join(SRC, ward.id, path.relative(dir, file)));
    console.log(`\n== ${ward.name}`);

    console.log('区役所「保育施設等の空き状況」（照合用）');
    if (ward.vacancyFile) {
      const vacancyUrl = (await listFiles(ward.vacancyPage, '(?:pdf|xlsx?)')).find((u) => ward.vacancyFile?.test(u));
      if (!vacancyUrl) throw new Error(`${ward.name}: 空き情報ファイルが見つからない（wards.ts の vacancyFile を確認）`);
      await download(vacancyUrl, path.join(dir, `vacancy${path.extname(vacancyUrl)}`));
    }
    // ページ本文にも空き人数の表を載せている区がある（天王寺区・浪速区など）。あればビルド時の照合に使う
    await download(ward.vacancyPage, path.join(dir, 'vacancy_page.html'));

    console.log('大阪市「保育施設等一覧」と各施設の基本情報PDF');
    for (const url of await listFiles(ward.listPage, 'xlsx')) await download(url, path.join(dir, 'list.xlsx'));
    for (const url of await listFiles(ward.listPage, 'pdf')) {
      const name = path.posix.basename(new URL(url).pathname);
      // 区の一覧PDF（"5.pdf" "14.pdf" のように数字だけのファイル名）と施設ごとのPDFを分ける
      await download(url, /^\d+\.pdf$/.test(name) ? path.join(dir, 'list.pdf') : path.join(dir, 'facility-pdfs', name));
    }

    console.log('区役所「企業主導型保育事業所の空き情報」（ページ内の表を使う）');
    await download(ward.kigyoPage, path.join(dir, 'kigyo_page.html'));
    if (ward.kigyoInfoPage) await download(ward.kigyoInfoPage, path.join(dir, 'kigyo_info_page.html'));
    if (ward.kigyoInfoFile) {
      const infoUrl = (await listFiles(ward.kigyoPage, 'pdf')).find((u) => ward.kigyoInfoFile?.test(u));
      if (!infoUrl) throw new Error(`${ward.name}: 企業主導型の一覧PDFが見つからない（wards.ts の kigyoInfoFile を確認）`);
      await download(infoUrl, path.join(dir, 'kigyo_info.pdf'));
    }
    if (ward.kigyoFile) {
      const kigyoUrl = (await listFiles(ward.kigyoPage, '(?:pdf|xlsx)')).find((u) => ward.kigyoFile?.test(u));
      if (!kigyoUrl) throw new Error(`${ward.name}: 企業主導型の空き情報ファイルが見つからない（wards.ts の kigyoFile を確認）`);
      await download(kigyoUrl, path.join(dir, `kigyo${path.extname(kigyoUrl)}`));
    }

    console.log('各施設のホームページが載っている区の資料');
    for (const [i, src] of ward.homepageSources.entries()) {
      await download(src.url, path.join(dir, 'homepage-sources', `${i + 1}.html`));
      for (const url of await listFiles(src.url, 'pdf')) {
        await download(url, path.join(dir, 'homepage-sources', `${i + 1}`, path.posix.basename(new URL(url).pathname)));
      }
    }
  });
}
