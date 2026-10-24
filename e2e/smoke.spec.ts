import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
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

test('クラス年齢を選ぶと件数の表示が変わる', async ({ page }) => {
  const summary = page.getByText(/件中.*に空きあり/);
  const before = await summary.textContent();
  const chip = page.getByRole('button', { name: '0歳', exact: true });

  await chip.click();

  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(summary).toContainText('0歳クラス');
  await expect(summary).not.toHaveText(before ?? '');
});

test('地図と施設のピンが表示される', async ({ page }) => {
  const map = page.getByRole('region', { name: '地図' });
  await expect(map.locator('.leaflet-container')).toBeVisible();
  await expect(map.locator('.leaflet-marker-icon').first()).toBeVisible();
});
