import { expect, test } from '@playwright/test';
import data from '../src/data/facilities.json' with { type: 'json' };

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
