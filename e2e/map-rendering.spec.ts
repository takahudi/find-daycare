import { waitForLocation } from './location.ts';
import { expect, test } from '@playwright/test';
import { mapAxe } from './map.ts';
import data from '../src/data/facilities.json' with { type: 'json' };

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

test('詳細の外にある施設ピンと自宅ピンもaxeで検査する', async ({ page, context }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 34.6937, longitude: 135.5023 });
  await page.goto('/?facility=kita-13311');
  await expect(page.locator('.facility-marker')).toHaveCount(data.facilities.length);
  const ready = page.locator('[aria-busy]:has(> .maplibregl-map)');
  await expect(ready).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: '現在地', exact: true }).click();
  await waitForLocation(page);
  await expect(page.locator('.maplibregl-marker .pin--home')).toBeVisible();
  await expect(ready).toHaveAttribute('aria-busy', 'false');
  const outside = await page.evaluate(() => {
    const map = document.querySelector('.maplibregl-map')!.getBoundingClientRect();
    const popup = document.querySelector('.maplibregl-popup')!.getBoundingClientRect();
    const facility = document.querySelector<HTMLElement>('.facility-marker')!;
    const home = document.querySelector<HTMLElement>('.maplibregl-marker:has(.pin--home)')!;
    const markers = [facility, home];
    return markers.map((marker, index) => {
      marker.dataset.axeProbe = 'true';
      marker.style.transform = 'translate(' + (map.width - 45 - index * 70) + 'px, 45px)';
      const label = marker.querySelector<HTMLElement>(index === 0 ? 'button' : '.pin--home')!;
      label.setAttribute('role', 'button');
      label.removeAttribute('aria-label');
      label.removeAttribute('title');
      label.textContent = '';
      label.style.width = '30px';
      label.style.height = '30px';
      const bounds = marker.getBoundingClientRect();
      return bounds.right <= popup.left || bounds.left >= popup.right || bounds.bottom <= popup.top || bounds.top >= popup.bottom;
    });
  });
  expect(outside).toEqual([true, true]);
  const results = await mapAxe(page, ['[data-axe-probe]']);
  const unnamedButtons = results[0].violations
    .filter((rule) => rule.id === 'button-name' || rule.id === 'aria-command-name')
    .flatMap((rule) => rule.nodes);
  expect(unnamedButtons).toHaveLength(2);
  for (const marker of [page.locator('.facility-marker').first(), page.locator('.maplibregl-marker:has(.pin--home)')]) {
    await expect(marker).toHaveCSS('visibility', 'visible');
  }
});
