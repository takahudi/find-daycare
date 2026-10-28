import { expect, test } from '@playwright/test';
import data from '../src/data/facilities.json' with { type: 'json' };
import { mapAxe, mapContrastSummary } from './map.ts';

for (const pixelRatio of [1, 2]) {
  test.describe(`ピクセル比${pixelRatio}`, () => {
    test.use({ deviceScaleFactor: pixelRatio });
    test('地図は同一オリジンのタイルと資産で描画し、204でもエラーやCSP違反を出さない', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      const external: string[] = [];
      const errors: string[] = [];
      const tiles: number[] = [];
      const assets: { path: string; status: number }[] = [];
      await page.route(/^https?:\/\/(?!localhost[:/])/, (route) => {
        external.push(route.request().url());
        return route.abort();
      });
      await page.addInitScript(() =>
        document.addEventListener('securitypolicyviolation', (event) =>
          console.error(`CSP violation: ${event.effectiveDirective} ${event.blockedURI}`),
        ),
      );
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('response', (response) => {
        const path = new URL(response.url()).pathname;
        if (path.startsWith('/map/tiles/')) tiles.push(response.status());
        if (path.startsWith('/map/assets/')) assets.push({ path, status: response.status() });
      });
      await page.goto('/');
      await expect(page.locator('.facility-marker')).toHaveCount(data.facilities.length);
      const canvas = page.locator('canvas.maplibregl-canvas');
      await expect(canvas).toBeVisible();
      await expect.poll(() => tiles.length).toBeGreaterThan(0);
      await expect.poll(() => assets.filter((asset) => asset.path.endsWith('.json')).length).toBeGreaterThan(0);
      await expect.poll(() => assets.filter((asset) => asset.path.endsWith('.png')).length).toBeGreaterThan(0);
      await expect.poll(() => assets.filter((asset) => asset.path.endsWith('.pbf')).length).toBeGreaterThan(0);
      await expect(page.getByRole('link', { name: 'OpenStreetMap contributors' })).toBeVisible();
      await expect(page.locator('[aria-busy="false"]:has(> .maplibregl-map)')).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(tiles.every((status) => status === 200 || status === 204)).toBe(true);
      expect(tiles).toContain(204);
      expect(assets.filter((asset) => asset.status !== 200)).toEqual([]);
      expect(errors).toEqual([]);
      expect(external).toEqual([]);
      expect(await canvas.evaluate((element: HTMLCanvasElement) => element.width > 0 && element.height > 0)).toBe(true);
    });
  });
}

test('不透明なポップアップでも文字のコントラスト不足は検出する', async ({ page }) => {
  const facility = data.facilities.find((candidate) => candidate.vacancies.every((value) => (value ?? 0) === 0))!;
  await page.goto('/');
  await expect(page.locator('.facility-marker')).toHaveCount(data.facilities.length);
  await expect(page.locator('[aria-busy]:has(> .maplibregl-map)')).toHaveAttribute('aria-busy', 'false');
  await page
    .locator('article[data-facility-id="' + facility.id + '"]')
    .getByRole('heading')
    .click();
  const popup = page.locator('.maplibregl-popup');
  await expect(popup).toBeVisible();
  await expect(page.locator('[aria-busy]:has(> .maplibregl-map)')).toHaveAttribute('aria-busy', 'false');
  await popup
    .locator('[role="group"] > div span')
    .last()
    .evaluate((node) => {
      node.style.color = getComputedStyle(node).backgroundColor;
    });
  const results = await mapAxe(page, ['.maplibregl-popup']);
  const violations = results.flatMap((result) => result.violations).filter((rule) => rule.id === 'color-contrast');
  const incomplete = await mapContrastSummary(page, results);
  expect(violations.length + incomplete.length).toBeGreaterThan(0);
});
