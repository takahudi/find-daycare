import {
  expectPinProbe,
  expectSelectedPinCount,
  homePinShown,
  pinCentre,
  clickPin,
  pixelColors,
  cssColor,
  vacancyTotal,
} from './map.ts';
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

test('同じ段でラベルが違うピンは南を手前に描き、画素で選んだ点からその施設を選べる', async ({ page }, testInfo) => {
  const candidates = data.facilities.filter((facility) => facility.licensing === 'licensed' && vacancyTotal(facility) > 0);
  const pair = candidates
    .flatMap((north) =>
      candidates
        .filter(
          (south) =>
            north.lat > south.lat &&
            north.facilityType !== south.facilityType &&
            vacancyTotal(north) !== vacancyTotal(south) &&
            distanceMeters(north, south) < 15,
        )
        .map((south) => ({ north, south, distance: distanceMeters(north, south) })),
    )
    .sort((a, b) => a.distance - b.distance)[0];
  expect(pair, '同じ空きありの段でラベルが違い、近接して重なる施設の組').toBeDefined();
  const { north, south } = pair;
  expect(north.lat).toBeGreaterThan(south.lat);
  expect(vacancyTotal(north)).not.toBe(vacancyTotal(south));
  await page.setViewportSize({ width: 1280, height: 800 });
  await openFacility(page, south.id);
  await page.getByRole('region', { name: '地図', exact: true }).getByRole('button', { name: 'Close popup' }).click();
  await page.evaluate(() => {
    history.pushState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expectSelectedPinCount(page, 0);
  const centre = (await pinCentre(page, south.id))!;
  const northCentre = (await pinCentre(page, north.id))!;
  expect(Math.hypot(centre.x - northCentre.x, centre.y - northCentre.y)).toBeLessThan(9);
  const capture = () => pixelColors(page, centre.x - 5, centre.y - 5, 10, 10);
  const both = await capture();
  const filters = page.getByRole('region', { name: '絞り込み' });
  const typeLabels: Record<string, string> = {
    nursery: '保育所',
    kodomoen: '認定こども園',
    community: '地域型保育（0〜2歳）',
    kigyo: '企業主導型',
  };
  const northFilter = filters.getByRole('button', { name: typeLabels[north.facilityType], exact: true });
  const southFilter = filters.getByRole('button', { name: typeLabels[south.facilityType], exact: true });
  await northFilter.click();
  await expect.poll(() => pinCentre(page, north.id)).toBeNull();
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  const southOnly = await capture();
  expect(both).toEqual(southOnly);
  await northFilter.click();
  await southFilter.click();
  await expect.poll(() => pinCentre(page, south.id)).toBeNull();
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  const northOnly = await capture();
  const labelColor = await cssColor(page, '--surface');
  const labelPixel = southOnly.findIndex(
    (color, index) =>
      color.every((c, i) => Math.abs(c - labelColor[i]) < 12) && northOnly[index].some((c, i) => Math.abs(c - color[i]) > 100),
  );
  expect(labelPixel).toBeGreaterThanOrEqual(0);
  await southFilter.click();
  await expect.poll(() => pinCentre(page, south.id)).not.toBeNull();
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  const point = {
    x: Math.floor(centre.x - 5) + (labelPixel % 10) + 0.5,
    y: Math.floor(centre.y - 5) + Math.floor(labelPixel / 10) + 0.5,
  };
  await testInfo.attach('south-over-north-label', {
    body: JSON.stringify({ north: north.id, south: south.id, both, southOnly, northOnly, point }),
    contentType: 'application/json',
  });
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('article[aria-current="true"]')).toHaveAttribute('data-facility-id', south.id);
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
