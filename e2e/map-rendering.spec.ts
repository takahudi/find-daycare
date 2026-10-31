import {
  expectFacilityPinCount,
  expectSelectedPinCount,
  renderedPins,
  pixelAt,
  clickPin,
  pixelColors,
  cssColor,
  vacancyTotal,
} from './map.ts';
import { expect, test } from '@playwright/test';
import data from '../src/data/facilities.json' with { type: 'json' };
import { pinGeometry } from '../src/features/map/pin-face.ts';

declare global {
  interface Window {
    pinSourceLoads: Record<string, number>;
  }
}

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
      await expectFacilityPinCount(page, data.facilities.length);
      const canvas = page.locator('canvas.maplibregl-canvas');
      await expect(canvas).toBeVisible();
      await expect.poll(() => tiles.length).toBeGreaterThan(0);
      await expect.poll(() => assets.filter((asset) => asset.path.endsWith('.json')).length).toBeGreaterThan(0);
      await expect.poll(() => assets.filter((asset) => asset.path.endsWith('.png')).length).toBeGreaterThan(0);
      await expect.poll(() => assets.filter((asset) => asset.path.endsWith('.pbf')).length).toBeGreaterThan(0);
      await expect(
        page.getByRole('region', { name: '地図', exact: true }).getByRole('link', { name: 'OpenStreetMap contributors' }),
      ).toBeVisible();
      await expect(page.locator('[aria-busy="false"]:has(> .maplibregl-map)')).toHaveCount(1);
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

test('選択・並べ替え・自宅の変更では全施設のデータを再送しない', async ({ page, context }) => {
  await page.addInitScript(() => {
    window.pinSourceLoads = {};
    const BrowserWorker = window.Worker;
    window.Worker = class extends BrowserWorker {
      override postMessage(message: unknown, options?: StructuredSerializeOptions | Transferable[]) {
        if (message && typeof message === 'object' && 'data' in message) {
          const payload = message.data;
          if (
            payload &&
            typeof payload === 'object' &&
            'source' in payload &&
            typeof payload.source === 'string' &&
            'data' in payload
          ) {
            window.pinSourceLoads[payload.source] = (window.pinSourceLoads[payload.source] ?? 0) + 1;
          }
        }
        super.postMessage(message, Array.isArray(options) ? { transfer: options } : options);
      }
    };
  });
  await page.goto('/');
  await expectFacilityPinCount(page, data.facilities.length);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 34.6937, longitude: 135.5023 });
  const before = await page.evaluate(() => ({ ...window.pinSourceLoads }));
  expect(before['facility-pins']).toBeGreaterThan(0);
  await page.locator(`article[data-facility-id="${data.facilities[0].id}"]`).getByRole('heading').click();
  await expectSelectedPinCount(page, 1);
  const after = await page.evaluate(() => ({ ...window.pinSourceLoads }));
  expect(after['facility-pins']).toBe(before['facility-pins']);
  expect(after['facility-pin-selected']).toBeGreaterThan(before['facility-pin-selected']);
  await page.getByRole('region', { name: '絞り込み' }).getByRole('combobox', { name: '並び順' }).selectOption('name');
  await page.getByRole('banner').getByRole('button', { name: '現在地', exact: true }).click();
  await expect.poll(async () => (await renderedPins(page)).filter((pin) => pin.layer === 'home-pin').length).toBe(1);
  await expect(page.locator('[aria-busy]:has(> .maplibregl-map)')).toHaveAttribute('aria-busy', 'false');
  expect(await page.evaluate(() => window.pinSourceLoads['facility-pins'])).toBe(before['facility-pins']);
});

test('空きありのピンは重なる空きなしのピンより上の色で描かれる', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expectFacilityPinCount(page, data.facilities.length);
  await expect(page.locator('[aria-busy]:has(> .maplibregl-map)')).toHaveAttribute('aria-busy', 'false');
  const overlap = await page.evaluate(() => {
    const probe = window.__findDaycarePins!;
    const pins = probe.rendered();
    for (const open of pins.filter((pin) => pin.layer === 'facility-pins-open')) {
      for (const full of pins.filter((pin) => pin.layer === 'facility-pins-full')) {
        if (Math.hypot(open.clientX - full.clientX, open.clientY - full.clientY) > 22) continue;
        for (const dy of [-8, 8]) {
          const x = open.clientX,
            y = open.clientY + dy;
          if (
            Math.hypot(x - full.clientX, y - full.clientY) < 12 &&
            probe.pick(x, y) === open.key &&
            document.elementFromPoint(x, y)?.matches('canvas.maplibregl-canvas')
          )
            return { x, y, open: open.key, full: full.key };
        }
      }
    }
    return null;
  });
  expect(overlap).not.toBeNull();
  const color = await pixelAt(page, overlap!.x, overlap!.y);
  const openColor = await cssColor(page, '--open');
  expect(color.every((channel, index) => Math.abs(channel - openColor[index]) < 20)).toBe(true);
  await testInfo.attach('open-over-full-pixel', { body: JSON.stringify({ ...overlap, color }), contentType: 'application/json' });
  await page.mouse.click(overlap!.x, overlap!.y);
  await expect(page.locator('article[aria-current="true"]')).toHaveCount(1);
  await expect(page.locator('article[aria-current="true"]')).toHaveAttribute('data-facility-id', overlap!.open);
});

test('選択したピンはアクセントの輪で強調し、閉じた詳細をクリックで開き直せる', async ({ page }, testInfo) => {
  const id = 'kita-13311';
  await page.goto('/?facility=' + id);
  await expectSelectedPinCount(page, 1);
  await expect(page.locator('[aria-busy]:has(> .maplibregl-map)')).toHaveAttribute('aria-busy', 'false');
  await page.locator('section[aria-label="地図"]').getByRole('button', { name: 'Close popup' }).click();
  const pin = (await renderedPins(page)).find((candidate) => candidate.layer === 'facility-pin-selected')!;
  const g = pinGeometry(pin.face, 'map');
  const color = await pixelAt(page, pin.clientX, pin.clientY + g.scale * (g.box / 2 + g.ring / 2));
  const accentColor = await cssColor(page, '--accent');
  expect(color.every((channel, index) => Math.abs(channel - accentColor[index]) < 20)).toBe(true);
  await testInfo.attach('selected-ring-pixel', { body: JSON.stringify({ color }), contentType: 'application/json' });
  await clickPin(page, id);
  await expect(page.locator('.maplibregl-popup')).toHaveCount(1);
});

for (const [id, shape] of [
  ['kita-13311', 'circle'],
  ['nishi-kigyo-01', 'square'],
] as const) {
  test(`${shape} の選択ピンの角を画素で区別する`, async ({ page }, testInfo) => {
    await page.goto('/?facility=' + id);
    await expectSelectedPinCount(page, 1);
    await expect(page.locator('[aria-busy]:has(> .maplibregl-map)')).toHaveAttribute('aria-busy', 'false');
    await page.locator('section[aria-label="地図"]').getByRole('button', { name: 'Close popup' }).click();
    const pin = (await renderedPins(page)).find((candidate) => candidate.layer === 'facility-pin-selected')!;
    expect(pin.face).toMatchObject({ shape });
    const corner = await pixelAt(page, pin.clientX + 16, pin.clientY + 16);
    const accentColor = await cssColor(page, '--accent');
    const accent = corner.every((channel, index) => Math.abs(channel - accentColor[index]) < 25);
    expect(accent).toBe(shape === 'square');
    await testInfo.attach('pin-face', {
      body: await page.screenshot({ clip: { x: pin.clientX - 24, y: pin.clientY - 24, width: 48, height: 48 } }),
      contentType: 'image/png',
    });
  });
}

test('ピンの中心に空きありは白い数字、空きなしはfull色の×を描く', async ({ page }, testInfo) => {
  const open = data.facilities.find((facility) => facility.licensing === 'licensed' && vacancyTotal(facility) > 0);
  const full = data.facilities.find((facility) => vacancyTotal(facility) === 0);
  expect(open, '空きありの認可施設').toBeDefined();
  expect(full, '空きなしの施設').toBeDefined();
  for (const facility of [open!, full!]) {
    const id = facility.id;
    const vacancy = vacancyTotal(facility);
    await page.goto('/?facility=' + id);
    await expectSelectedPinCount(page, 1);
    await expect(page.locator('[aria-busy]:has(> .maplibregl-map)')).toHaveAttribute('aria-busy', 'false');
    await page.getByRole('region', { name: '地図', exact: true }).getByRole('button', { name: 'Close popup' }).click();
    const pin = (await renderedPins(page)).find((candidate) => candidate.layer === 'facility-pin-selected')!;
    expect(pin.face).toMatchObject({ vacancy });
    const rgb = await cssColor(page, vacancy > 0 ? '--surface' : '--full');
    const pixels = await pixelColors(page, pin.clientX - 7, pin.clientY - 7, 14, 14);
    expect(pixels.filter((pixel) => pixel.every((channel, i) => Math.abs(channel - rgb[i]) < 12)).length).toBeGreaterThan(8);
    await testInfo.attach(id + '-label', {
      body: await page.screenshot({
        clip: { x: Math.floor(pin.clientX - 24), y: Math.floor(pin.clientY - 24), width: 48, height: 48 },
      }),
      contentType: 'image/png',
    });
  }
});

test('ポインターを動かさず絞り込みや地図移動をしてもカーソルを更新する', async ({ page }) => {
  await page.goto('/?facility=higashiyodogawa-133106');
  await expectSelectedPinCount(page, 1);
  const region = page.getByRole('region', { name: '地図', exact: true });
  const ready = page.locator('[aria-busy]:has(> .maplibregl-map)');
  await expect(ready).toHaveAttribute('aria-busy', 'false');
  await region.getByRole('button', { name: 'Close popup' }).click();
  for (let step = 0; step < 2; step++) {
    await region.getByRole('button', { name: 'Zoom in' }).click();
    await expect(ready).toHaveAttribute('aria-busy', 'false');
  }
  await expect(region.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
  await expect(ready).toHaveAttribute('aria-busy', 'false');
  const pin = (await renderedPins(page)).find((candidate) => candidate.layer === 'facility-pin-selected')!;
  const canvas = page.locator('canvas.maplibregl-canvas');
  await page.mouse.move(pin.clientX, pin.clientY);
  await expect(canvas).toHaveCSS('cursor', 'pointer');
  const nursery = page.getByRole('region', { name: '絞り込み' }).getByRole('button', { name: '保育所', exact: true });
  await nursery.evaluate((button: HTMLButtonElement) => button.click());
  await expectSelectedPinCount(page, 0);
  await expect(canvas).not.toHaveCSS('cursor', 'pointer');
  await nursery.evaluate((button: HTMLButtonElement) => button.click());
  await expectSelectedPinCount(page, 1);
  await expect(ready).toHaveAttribute('aria-busy', 'false');
  await expect(canvas).toHaveCSS('cursor', 'pointer');
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await expect(ready).toHaveAttribute('aria-busy', 'false');
  await expect(canvas).not.toHaveCSS('cursor', 'pointer');
});

test('空いた地図をドラッグするとき、開始点へピンが来てもカーソルはpointerにならない', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?facility=higashiyodogawa-133106');
  await expectSelectedPinCount(page, 1);
  const region = page.getByRole('region', { name: '地図', exact: true });
  const ready = page.locator('[aria-busy]:has(> .maplibregl-map)');
  await expect(ready).toHaveAttribute('aria-busy', 'false');
  await region.getByRole('button', { name: 'Close popup' }).click();
  for (let step = 0; step < 2; step++) {
    await region.getByRole('button', { name: 'Zoom in' }).click();
    await expect(ready).toHaveAttribute('aria-busy', 'false');
  }
  await expect(region.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
  const pin = (await renderedPins(page)).find((candidate) => candidate.layer === 'facility-pin-selected')!;
  const start = { x: pin.clientX - 120, y: pin.clientY };
  const end = { x: start.x - 120, y: start.y };
  const pickAt = (point: { x: number; y: number }) => page.evaluate((p) => window.__findDaycarePins!.pick(p.x, p.y), point);
  expect(await pickAt(start)).toBeNull();
  expect(await pickAt(end)).toBeNull();
  const canvas = page.locator('canvas.maplibregl-canvas');
  await page.mouse.move(start.x, start.y);
  await expect(canvas).not.toHaveCSS('cursor', 'pointer');
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 30 });
  // 慣性でピンが通り過ぎないよう、ポインターを止めてから離す。
  await page.waitForTimeout(200);
  await page.mouse.up();
  await expect(ready).toHaveAttribute('aria-busy', 'false');
  await expect.poll(() => pickAt(start)).toBe(pin.key);
  expect(await pickAt(end)).toBeNull();
  await testInfo.attach('drag-cursor', {
    body: JSON.stringify({
      start,
      end,
      pin: pin.key,
      cursor: await canvas.evaluate((element) => getComputedStyle(element).cursor),
    }),
    contentType: 'application/json',
  });
  await expect(canvas).not.toHaveCSS('cursor', 'pointer');
});
