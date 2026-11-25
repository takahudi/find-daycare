import { expect, test, type Page } from '@playwright/test';
import { mapAxe, mapContrastSummary, openVisibleUnlicensedPopup, viewToggle } from './map.ts';

const DARK_BG = 'rgb(20, 21, 24)';
const DARK_SURFACE = 'rgb(29, 31, 36)';
const LIGHT_BG = 'rgb(246, 244, 239)';
const LIGHT_SURFACE = 'rgb(255, 255, 255)';

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
  await page.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
});

test.afterEach(async ({ page }) => {
  expect(violationsByPage.get(page), '読み込みと操作の間に CSP 違反がない').toEqual([]);
});

test('デフォルトはシステムの配色設定に従い、未切替ならOSの変更にも追従する', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');

  const banner = page.getByRole('banner');
  const toLight = banner.getByRole('button', { name: 'ライトモードに切り替え', exact: true });
  await expect(toLight).toBeVisible();
  await expect(page.locator(':root')).toHaveCSS('background-color', DARK_BG);
  await expect(banner).toHaveCSS('background-color', DARK_SURFACE);
  await expect(page.locator(':root')).not.toHaveAttribute('data-theme', /.+/);

  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator(':root')).toHaveCSS('background-color', LIGHT_BG);
  await expect(banner).toHaveCSS('background-color', LIGHT_SURFACE);
  await expect(banner.getByRole('button', { name: 'ダークモードに切り替え', exact: true })).toBeVisible();
});

for (const [device, viewport] of [
  ['デスクトップ', { width: 1280, height: 800 }],
  ['モバイル', { width: 390, height: 844 }],
] as const) {
  test(`${device}で右上端アイコンからダークモードを切り替え、再読み込み後も保持する`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');

    const banner = page.getByRole('banner');
    const toggleToDark = banner.getByRole('button', { name: 'ダークモードに切り替え', exact: true });
    await expect(toggleToDark).toBeVisible();

    const [bannerBox, buttonBox, headingBox] = await Promise.all([
      banner.boundingBox(),
      toggleToDark.boundingBox(),
      page.getByRole('heading', { level: 1 }).boundingBox(),
    ]);
    expect(bannerBox && buttonBox && headingBox).toBeTruthy();
    // 右上端にあることを座標で確かめる。
    expect(bannerBox!.x + bannerBox!.width - (buttonBox!.x + buttonBox!.width)).toBeLessThanOrEqual(28);
    expect(buttonBox!.y - bannerBox!.y).toBeLessThanOrEqual(32);
    if (device === 'モバイル') {
      expect(buttonBox!.y).toBeLessThan(headingBox!.y + headingBox!.height);
    }

    await toggleToDark.click();
    await expect(page.locator(':root')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator(':root')).toHaveCSS('background-color', DARK_BG);
    await expect(banner).toHaveCSS('background-color', DARK_SURFACE);
    await expect(banner.getByRole('button', { name: 'ライトモードに切り替え', exact: true })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('find-daycare:theme'))).toBe('dark');

    await page.reload();
    await expect(page.locator(':root')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator(':root')).toHaveCSS('background-color', DARK_BG);
    await expect(banner.getByRole('button', { name: 'ライトモードに切り替え', exact: true })).toBeVisible();

    await banner.getByRole('button', { name: 'ライトモードに切り替え', exact: true }).click();
    await expect(page.locator(':root')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator(':root')).toHaveCSS('background-color', LIGHT_BG);
    expect(await page.evaluate(() => localStorage.getItem('find-daycare:theme'))).toBe('light');
  });
}

test('ダークモードでも地図と凡例・ポップアップはライト配色を保ち、アクセシビリティ違反がない', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');

  const mapRegion = page.locator('section[aria-label="地図"]');
  const mapContainer = mapRegion.locator('[aria-busy]');
  const legend = mapRegion.getByRole('group', { name: '地図の凡例' });
  await expect(mapContainer).toHaveCSS('background-color', LIGHT_BG);
  await expect(legend).toHaveCSS('color', 'rgb(35, 38, 43)');

  // 絞り込みパネルとポップアップも開いた状態でコントラストとアクセシビリティを検査する。
  const filters = page.getByRole('region', { name: '絞り込み' });
  await filters.getByRole('button', { name: '0歳', exact: true }).click();
  await filters.getByRole('button', { name: /^種別 / }).click();
  await expect(page.getByRole('group', { name: '種別', exact: true })).toBeVisible();
  await openVisibleUnlicensedPopup(page);
  await expect(mapRegion.getByRole('group', { name: '施設の詳細' })).toBeVisible();

  const selectors = [
    'header:has(h1)',
    '[aria-label="絞り込み"]',
    '[aria-label="施設一覧"] > div:first-child',
    '[aria-label="施設一覧"] > footer',
    'section[aria-label="地図"]',
  ];
  const firstCardId = await page
    .getByRole('region', { name: '施設一覧' })
    .getByRole('article')
    .first()
    .getAttribute('data-facility-id');
  if (firstCardId) selectors.push(`article[data-facility-id="${firstCardId}"]`);

  const results = await mapAxe(page, selectors);
  const violations = results.flatMap((result) => result.violations);
  const incomplete = mapContrastSummary(results);
  await testInfo.attach('dark-axe-incomplete', {
    body: JSON.stringify(incomplete, null, 2),
    contentType: 'application/json',
  });
  if (violations.length > 0) {
    await testInfo.attach('dark-axe-violations', {
      body: JSON.stringify(violations, null, 2),
      contentType: 'application/json',
    });
  }
  expect(violations).toEqual([]);
});

test('モバイルのダークモードでリスト表示と地図ポップアップにアクセシビリティ違反がない', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');

  const firstCardId = await page
    .getByRole('region', { name: '施設一覧' })
    .getByRole('article')
    .first()
    .getAttribute('data-facility-id');
  const listResults = await mapAxe(page, [
    'header:has(h1)',
    '[aria-label="絞り込み"]',
    '[aria-label="表示切替"]',
    '[aria-label="施設一覧"] > div:first-child',
    ...(firstCardId ? [`article[data-facility-id="${firstCardId}"]`] : []),
  ]);
  expect(listResults.flatMap((result) => result.violations)).toEqual([]);

  await viewToggle(page).getByRole('button', { name: '地図', exact: true }).click();
  const map = page.locator('section[aria-label="地図"]');
  await map.scrollIntoViewIfNeeded();
  await openVisibleUnlicensedPopup(page);
  const mapResults = await mapAxe(page, ['header:has(h1)', '[aria-label="表示切替"]', 'section[aria-label="地図"]']);
  expect(mapResults.flatMap((result) => result.violations)).toEqual([]);
});
