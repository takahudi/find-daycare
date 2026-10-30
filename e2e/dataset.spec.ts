import { expect, test, type Page } from '@playwright/test';
import { mapAxe, mapContrastSummary } from './map.ts';

const datasetRoute = '**/assets/facilities-*.json';

async function expectAccessible(page: Page) {
  const results = await mapAxe(page);
  expect(results.flatMap((result) => result.violations)).toEqual([]);
  expect(await mapContrastSummary(page, results)).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
});

for (const [name, viewport] of [
  ['デスクトップ', { width: 1280, height: 800 }],
  ['モバイル', { width: 390, height: 844 }],
] as const) {
  test(`${name}で静的HTMLに施設データの読み込み中を表示し、取得後にカードを表示する`, async ({ page }) => {
    await page.setViewportSize(viewport);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(datasetRoute, async (route) => {
      await held;
      await route.continue();
    });
    try {
      const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
      expect(await response!.text()).toContain('<p role="status">施設データを読み込んでいます…</p>');
      await expect(page.getByRole('article')).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 1, name: '大阪市の保育施設 空き状況マップ' })).toBeVisible();
      await expect(page.getByRole('status')).toHaveText('施設データを読み込んでいます…');
      await expect(page.getByRole('heading', { level: 1 }).locator('span')).toHaveCSS('color', 'rgb(232, 116, 59)');
      await expectAccessible(page);
    } finally {
      release();
    }
    // 未出現時の可視性診断が全カードの描画を強制しないよう、先に件数で待つ。
    await expect(page.getByRole('status')).toHaveCount(0);
    await expect(page.getByRole('region', { name: '施設一覧' }).getByRole('article').first()).toHaveCount(1);
    await expect(page.getByRole('region', { name: '施設一覧' }).getByRole('article').first()).toBeVisible();
  });

  test(`${name}で施設データの取得失敗と再読み込みを表示する`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route(datasetRoute, (route) => route.fulfill({ status: 500, json: {} }));
    await page.goto('/');
    await expect(page.getByRole('alert')).toContainText('施設データを読み込めませんでした。');
    await expect(page.getByRole('heading', { level: 1 }).locator('span')).toHaveCSS('color', 'rgb(232, 116, 59)');
    await expect(page.getByRole('alert')).toContainText('施設データの取得に失敗しました（HTTP 500）。');
    await expect(page.getByRole('button', { name: '再読み込み', exact: true })).toBeVisible();
    await expect(page.getByRole('alert').getByRole('paragraph')).toHaveCount(2);
    await expect(page.getByRole('status')).toHaveCount(0);
    await expect(page.getByRole('article')).toHaveCount(0);
    await expectAccessible(page);
    await page.unroute(datasetRoute);
    await page.getByRole('button', { name: '再読み込み', exact: true }).click();
    await expect(page.getByRole('region', { name: '施設一覧' }).getByRole('article').first()).toHaveCount(1);
    await expect(page.getByRole('region', { name: '施設一覧' }).getByRole('article').first()).toBeVisible();
  });
}

test('施設データのハッシュ付きJSONは長期キャッシュと共通セキュリティヘッダーを返す', async ({ page }) => {
  const datasetResponse = page.waitForResponse((response) => /\/assets\/facilities-[^/]+\.json$/.test(response.url()));
  const documentResponse = await page.goto('/');
  const response = await datasetResponse;
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect(response.headers()['content-security-policy']).toBeTruthy();
  expect(response.headers()['content-security-policy']).toBe(documentResponse?.headers()['content-security-policy']);
  await expect(page.getByRole('region', { name: '施設一覧' }).getByRole('article').first()).toHaveCount(1);
  await expect(page.getByRole('region', { name: '施設一覧' }).getByRole('article').first()).toBeVisible();
});

test('施設データはビルドHTMLのpreloadと同じURLを一度だけ取得する', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (/\/assets\/facilities-[^/]+\.json$/.test(request.url())) requests.push(request.url());
  });
  const documentResponse = await page.goto('/');
  await expect(page.getByRole('region', { name: '施設一覧' }).getByRole('article').first()).toHaveCount(1);
  await expect(page.getByRole('region', { name: '施設一覧' }).getByRole('article').first()).toBeVisible();
  const preload = page.locator('link#facilities-data[rel="preload"][as="fetch"]');
  await expect(preload).toHaveCount(1);
  await expect(preload).toHaveAttribute('crossorigin', '');
  const href = await preload.getAttribute('href');
  expect(href).toMatch(/^\/assets\/facilities-[^/]+\.json$/);
  expect(await documentResponse!.text()).toContain(`<link id="facilities-data" rel="preload" href="${href}"`);
  expect(requests).toEqual([new URL(href!, page.url()).href]);
  const resource = await page.evaluate(() => {
    const json = performance
      .getEntriesByType('resource')
      .filter((entry): entry is PerformanceResourceTiming => entry instanceof PerformanceResourceTiming)
      .filter((entry) => /\/assets\/facilities-[^/]+\.json$/.test(entry.name));
    return json.map((entry) => ({ url: entry.name, initiator: entry.initiatorType }));
  });
  expect(resource).toEqual([{ url: requests[0], initiator: 'link' }]);
});

for (const [name, response, message] of [
  ['通信の失敗', 'abort', '施設データを取得できませんでした。通信状態を確かめてください。'],
  ['200のHTML応答', 'html', '施設データの形式が正しくありません。'],
] as const) {
  test(name + 'を日本語で表示する', async ({ page }) => {
    await page.route(datasetRoute, (route) =>
      response === 'abort' ? route.abort() : route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' }),
    );
    await page.goto('/');
    await expect(page.getByRole('alert')).toContainText(message);
    await expect(page.getByRole('status')).toHaveCount(0);
    await expectAccessible(page);
  });
}

test('施設データの応答が止まっても30秒で日本語の期限切れを表示する', async ({ page }) => {
  test.setTimeout(45_000);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(datasetRoute, async (route) => {
    await held;
    await route.abort();
  });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('status')).toHaveText('施設データを読み込んでいます…');
    await expect(page.getByRole('alert')).toContainText('施設データの取得に時間がかかりすぎました。', { timeout: 35_000 });
    await expect(page.getByRole('status')).toHaveCount(0);
    await expectAccessible(page);
  } finally {
    release();
  }
});

test('preloadのリンクがなければ日本語で読み込み先の不備を表示する', async ({ page }) => {
  await page.route('/', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace(/<link id="facilities-data"[^>]*>/, '') });
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('施設データの読み込み先が見つかりません。');
});

test('JavaScriptが無効でも表示に必要な設定を案内する', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(baseURL!);
    await expect(page.locator('noscript')).toBeVisible();
    expect(await page.locator('noscript').textContent()).toBe('施設の空き状況を表示するには JavaScript を有効にしてください。');
  } finally {
    await context.close();
  }
});
