import { expect, test, type Page } from '@playwright/test';
import data from '../src/data/facilities.json' with { type: 'json' };

function parseCsp(header: string) {
  const directives = new Map<string, Set<string>>();
  for (const directive of header.split(';').filter((value) => value.trim())) {
    const [name, ...sources] = directive.trim().split(/\s+/);
    const normalizedName = name.toLowerCase();
    expect(directives.has(normalizedName), `CSP directive の重複: ${normalizedName}`).toBe(false);
    directives.set(normalizedName, new Set(sources));
  }
  return directives;
}

const expectedCsp = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'connect-src': ["'self'", 'https://msearch.gsi.go.jp'],
  'img-src': ["'self'", 'data:', 'https://cyberjapandata.gsi.go.jp'],
  'font-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
};

const violationsByPage = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const violations: string[] = [];
  violationsByPage.set(page, violations);
  page.on('console', (message) => {
    if (message.text().startsWith('CSP violation:')) violations.push(message.text());
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.error(`CSP violation: ${event.effectiveDirective} ${event.blockedURI}`);
    });
  });
  // 地図タイルと住所検索は外部サービスなので、テストの結果をそれらの応答に左右させない
  await page.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
  await page.goto('/');
});

test('トップページを開ける', async ({ page }) => {
  await expect(page).toHaveTitle('大阪市 保育施設 空き状況マップ');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('空き状況マップ');
});

test('施設のカードが表示される', async ({ page }) => {
  const cards = page.getByRole('region', { name: '施設一覧' }).getByRole('article');
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThan(0);
});

test('クラス年齢を選ぶと、その年齢を受け入れる施設と空きのある施設の件数に絞られる', async ({ page }) => {
  const { facilities } = data;
  const hasOpening = (f: { vacancies: (number | null)[] }, ages: number[]) => ages.some((a) => (f.vacancies[a] ?? 0) > 0);
  const acceptingZero = facilities.filter((f) => f.vacancies[0] !== null);
  const summary = page.getByText(/件中.*に空きあり/);
  const chip = page.getByRole('button', { name: '0歳', exact: true });

  await expect(summary).toHaveText(
    `${facilities.length}件中 ${facilities.filter((f) => hasOpening(f, [0, 1, 2, 3, 4, 5])).length}件に空きあり`,
  );

  await chip.click();

  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(summary).toHaveText(
    `${acceptingZero.length}件中 ${acceptingZero.filter((f) => hasOpening(f, [0])).length}件に空きあり（0歳クラス）`,
  );
});

test('地図と施設のピンが表示される', async ({ page }) => {
  const map = page.getByRole('region', { name: '地図' });
  await expect(map.locator('.leaflet-container')).toBeVisible();
  await expect(map.locator('.leaflet-marker-icon').first()).toBeVisible();
});

test('住所を検索すると、その住所からの距離で施設を表示する', async ({ page }) => {
  const address = '大阪市北区中之島1-3-20';
  await page.route('https://msearch.gsi.go.jp/**', (route) =>
    route.fulfill({
      json: [{ geometry: { coordinates: [135.5023, 34.6937] }, properties: { title: address } }],
    }),
  );

  await page.getByRole('searchbox', { name: '自宅の住所' }).fill(address);
  await page.getByRole('button', { name: '近い順に並べる' }).click();

  await expect(page.getByRole('status')).toContainText(address);
  await expect(page.getByRole('status')).toContainText('からの直線距離で表示中');
  await expect(page.getByRole('region', { name: '施設一覧' }).getByRole('article').first()).toContainText('自宅から');
});

test.afterEach(async ({ page }) => {
  expect(violationsByPage.get(page), '読み込みと操作の間に CSP 違反がない').toEqual([]);
});

for (const path of ['/', '/no-such-page']) {
  test(`${path} はセキュリティヘッダー付きでアプリを表示する`, async ({ page }) => {
    const response = await page.goto(path);

    expect(response?.status()).toBe(200);
    expect(response?.headers()).toMatchObject({
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'cross-origin-opener-policy': 'same-origin',
    });
    const csp = response?.headers()['content-security-policy'];
    expect(csp).toBeDefined();
    const directives = parseCsp(csp ?? '');
    expect(directives).toEqual(new Map(Object.entries(expectedCsp).map(([name, sources]) => [name, new Set(sources)])));
    const permissionsPolicy = response?.headers()['permissions-policy'];
    expect(permissionsPolicy).toBeDefined();
    expect(permissionsPolicy).toContain('geolocation=(self)');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('空き状況マップ');
    await expect(page.getByRole('region', { name: '施設一覧' }).getByRole('article').first()).toBeVisible();
  });
}

test('/wrangler.json は生成ファイルを公開せず SPA HTML を返す', async ({ request }) => {
  const response = await request.get('/wrangler.json');

  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/html');
  expect(await response.text()).toBe(await (await request.get('/')).text());
});

test('施設種別の選択肢を保ち、企業主導型と認可外を別のバッジで表示する', async ({ page }) => {
  const chips = page.locator('.filters__group').filter({ hasText: '種別' }).getByRole('button');
  await expect(chips).toHaveText(['保育所', '認定こども園', '地域型保育（0〜2歳）', '企業主導型']);
  const cards = page.getByRole('region', { name: '施設一覧' }).getByRole('article');
  await expect(cards).toHaveCount(data.facilities.length);
  for (const label of ['保育所', '認定こども園', '地域型保育（0〜2歳）']) {
    await page.getByRole('button', { name: label, exact: true }).click();
  }
  const kigyoCount = data.facilities.filter((facility) => facility.facilityType === 'kigyo').length;
  await expect(cards).toHaveCount(kigyoCount);
  await expect(cards.first().locator('.card__badges .badge')).toHaveText([/.+区/, '企業主導型', '認可外']);
  await expect(cards.first().locator('.card__caution')).toHaveText(
    '認可外保育施設です。申込みは区役所ではなく施設との直接契約です（空き人数は地域枠）。',
  );
  await expect(page.locator('.leaflet-marker-icon .pin--unlicensed')).toHaveCount(kigyoCount);
  await expect(page.locator('.legend')).toContainText('認可外');
  await page.getByRole('button', { name: '企業主導型', exact: true }).click();
  await page.getByRole('button', { name: '保育所', exact: true }).click();
  await expect(cards).toHaveCount(data.facilities.filter((facility) => facility.facilityType === 'nursery').length);
  await expect(cards.first().locator('.badge--nursery')).toHaveText('保育所');
  await expect(cards.first().locator('.badge--unlicensed')).toHaveCount(0);
  await expect(cards.first().locator('.card__caution')).toHaveCount(0);
  await expect(page.locator('.leaflet-marker-icon .pin--unlicensed')).toHaveCount(0);
});
