import { expectPinProbe, expectFacilityPinCount, expectSelectedPinCount, homePinShown, pinCentre, clickPin } from './map.ts';
import { viewToggle } from './map.ts';
import { waitForLocation } from './location.ts';
import { expect, test, type Page } from '@playwright/test';
import data from '../src/data/facilities.json' with { type: 'json' };
import { distanceMeters } from '../src/lib/geo.ts';

const ready = (page: Page) => page.locator('[aria-busy]:has(> .maplibregl-map)');
async function openFacility(page: Page, id: string) {
  await page.goto('/?facility=' + id);
  await expectPinProbe(page);
  await expect(page.locator('.maplibregl-popup')).toBeVisible();
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  await expectSelectedPinCount(page, 1);
}

test('ポップアップを開いたままドラッグしても地図の位置が引き戻されない', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openFacility(page, data.facilities[0].id);
  const before = (await page.locator('.maplibregl-popup').boundingBox())!;
  const canvas = (await page.locator('.maplibregl-canvas').boundingBox())!;
  const x = canvas.x + canvas.width - 25;
  const y = canvas.y + canvas.height - 60;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 400, y, { steps: 30 });
  // マウスを止めてから離し、慣性による移動とポップアップの引き戻しを区別する。
  await page.waitForTimeout(200);
  await page.mouse.up();
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  await expect
    .poll(async () => Math.abs((await page.locator('.maplibregl-popup').boundingBox())!.x - (before.x - 400)))
    .toBeLessThan(5);
  await expect(page.locator('.maplibregl-popup')).toHaveCount(1);
});

test('ポップアップを開いたまま現在地を選ぶと自宅と近い5施設が地図に収まる', async ({ page, context }) => {
  const home = { lat: 34.6937, lng: 135.5023 };
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: home.lat, longitude: home.lng });
  await page.setViewportSize({ width: 1280, height: 800 });
  const farthest = [...data.facilities].sort((a, b) => distanceMeters(home, b) - distanceMeters(home, a))[0];
  await openFacility(page, farthest.id);
  await page.getByRole('banner').getByRole('button', { name: '現在地', exact: true }).click();
  await waitForLocation(page);
  await expect.poll(() => homePinShown(page)).toBe(true);
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  await expect.poll(() => homePinShown(page)).toBe(true);
  const nearest = [...data.facilities].sort((a, b) => distanceMeters(home, a) - distanceMeters(home, b)).slice(0, 5);
  for (const facility of nearest) {
    await expect.poll(() => pinCentre(page, facility.id)).not.toBeNull();
  }
  await expect(page.locator('.maplibregl-popup')).toHaveCount(1);
});

test('閉じた詳細は年齢条件で施設を隠して戻しても閉じたままで、ピンで再度開ける', async ({ page }) => {
  const facility = data.facilities.find((candidate) => candidate.vacancies[0] === null)!;
  await openFacility(page, facility.id);
  await page.locator('section[aria-label="地図"]').getByRole('button', { name: 'Close popup' }).click();
  await expect(page.locator('.maplibregl-popup')).toHaveCount(0);
  await page.getByRole('region', { name: '絞り込み' }).getByRole('button', { name: '0歳', exact: true }).click();
  await expectSelectedPinCount(page, 0);
  await page.getByRole('region', { name: '絞り込み' }).getByRole('button', { name: '0歳', exact: true }).click();
  await expectSelectedPinCount(page, 1);
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.maplibregl-popup')).toHaveCount(0);
  await clickPin(page, facility.id);
  await expect(page.locator('.maplibregl-popup')).toBeVisible();
  await clickPin(page, facility.id);
  await expect(page.locator('.maplibregl-popup')).toHaveCount(0);
});

test('同じ段で重なるピンでは南の施設を実際のクリックで選ぶ', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expectFacilityPinCount(page, data.facilities.length);
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  const overlap = await page.evaluate(() => {
    const probe = window.__findDaycarePins!;
    const pins = probe.rendered().filter((p) => p.layer === 'facility-pins-open');
    for (const a of pins)
      for (const b of pins) {
        if (a.key === b.key || Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) > 20) continue;
        const x = (a.clientX + b.clientX) / 2,
          y = (a.clientY + b.clientY) / 2;
        const top = probe.pick(x, y);
        if ((top === a.key || top === b.key) && document.elementFromPoint(x, y)?.matches('canvas.maplibregl-canvas'))
          return { a: a.key, b: b.key, top, x, y };
      }
    return null;
  });
  expect(overlap).not.toBeNull();
  const a = data.facilities.find((f) => f.id === overlap!.a)!;
  const b = data.facilities.find((f) => f.id === overlap!.b)!;
  expect(overlap!.top).toBe(a.lat < b.lat ? a.id : b.id);
  await page.mouse.click(overlap!.x, overlap!.y);
  await expect(page.locator('article[aria-current="true"]')).toHaveCount(1);
  await expect(page.locator('article[aria-current="true"]')).toHaveAttribute('data-facility-id', overlap!.top);
});

test('閉じた詳細は別のカードを選んでから選び直すと再び開く', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expectPinProbe(page);
  const [first, second] = data.facilities;
  const card = (id: string) => page.locator('article[data-facility-id="' + id + '"]');
  await card(first.id).getByRole('heading').click();
  await expect(page.getByRole('group', { name: '施設の詳細' })).toContainText(first.name);
  await page.locator('section[aria-label="地図"]').getByRole('button', { name: 'Close popup' }).click();
  await card(second.id).getByRole('heading').click();
  await expect(page.getByRole('group', { name: '施設の詳細' })).toContainText(second.name);
  await card(first.id).getByRole('heading').click();
  await expect(page.getByRole('group', { name: '施設の詳細' })).toContainText(first.name);
});

for (const viewport of [
  { width: 1280, height: 500 },
  { width: 390, height: 250 },
]) {
  test('初期URL選択の詳細が地図内に収まる ' + viewport.width + '×' + viewport.height, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/?facility=taisho-82305');
    await expectPinProbe(page);
    if (viewport.width === 390) await viewToggle(page).getByRole('button', { name: '地図', exact: true }).click();
    await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
    const map = (await page.locator('.maplibregl-map').boundingBox())!;
    await expect
      .poll(async () => {
        const popup = (await page.locator('.maplibregl-popup').boundingBox())!;
        return (
          popup.x >= map.x &&
          popup.y >= map.y &&
          popup.x + popup.width <= map.x + map.width &&
          popup.y + popup.height <= map.y + map.height
        );
      })
      .toBe(true);
  });
}
