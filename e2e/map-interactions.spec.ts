import { expect, test, type Page } from '@playwright/test';
import data from '../src/data/facilities.json' with { type: 'json' };
import { distanceMeters } from '../src/lib/geo.ts';

const ready = (page: Page) => page.locator('[aria-busy]:has(> .maplibregl-map)');
async function openFacility(page: Page, id: string) {
  await page.goto('/?facility=' + id);
  await expect(page.locator('.facility-marker')).toHaveCount(data.facilities.length);
  await expect(page.locator('.maplibregl-popup')).toBeVisible();
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
}

test('ポップアップを開いたままドラッグしても地図の位置が引き戻されない', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openFacility(page, data.facilities[0].id);
  const marker = page.locator('.facility-marker:has(.pin--selected)');
  const before = (await marker.boundingBox())!;
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
  await expect.poll(async () => Math.abs((await marker.boundingBox())!.x - (before.x - 400))).toBeLessThan(5);
  await expect(page.locator('.maplibregl-popup')).toHaveCount(1);
});

test('ポップアップを開いたまま現在地を選ぶと自宅と近い5施設が地図に収まる', async ({ page, context }) => {
  const home = { lat: 34.6937, lng: 135.5023 };
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: home.lat, longitude: home.lng });
  await page.setViewportSize({ width: 1280, height: 800 });
  const farthest = [...data.facilities].sort((a, b) => distanceMeters(home, b) - distanceMeters(home, a))[0];
  await openFacility(page, farthest.id);
  await page.getByRole('button', { name: '現在地', exact: true }).click();
  await expect(page.locator('.maplibregl-marker .pin--home')).toBeVisible();
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.maplibregl-marker:has(.pin--home)')).toBeInViewport();
  const nearest = [...data.facilities].sort((a, b) => distanceMeters(home, a) - distanceMeters(home, b)).slice(0, 5);
  for (const facility of nearest) {
    const marker = page
      .locator('.facility-marker')
      .filter({ has: page.getByRole('button', { name: facility.name + '（', exact: false }) });
    await expect(marker).toBeInViewport();
  }
  await expect(page.locator('.maplibregl-popup')).toHaveCount(1);
});

test('閉じた詳細は年齢条件で施設を隠して戻しても閉じたままで、ピンで再度開ける', async ({ page }) => {
  const facility = data.facilities.find((candidate) => candidate.vacancies[0] === null)!;
  await openFacility(page, facility.id);
  await page.getByRole('button', { name: 'Close popup' }).click();
  await expect(page.locator('.maplibregl-popup')).toHaveCount(0);
  await page.getByRole('button', { name: '0歳', exact: true }).click();
  await expect(page.locator('.pin--selected')).toHaveCount(0);
  await page.getByRole('button', { name: '0歳', exact: true }).click();
  await expect(page.locator('.pin--selected')).toHaveCount(1);
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.maplibregl-popup')).toHaveCount(0);
  await page.locator('.facility-marker:has(.pin--selected) button').click();
  await expect(page.locator('.maplibregl-popup')).toBeVisible();
  await page.locator('.facility-marker:has(.pin--selected) button').click();
  await expect(page.locator('.maplibregl-popup')).toHaveCount(0);
});

test('同じ段の重なったピンでは南の施設が手前になる', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.locator('.facility-marker')).toHaveCount(data.facilities.length);
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  const sameTier = data.facilities.filter((facility) => facility.vacancies.some((value) => (value ?? 0) > 0));
  const [south, north] = [...sameTier]
    .sort((a, b) => a.lat - b.lat)
    .filter((_, index, all) => index === 0 || index === all.length - 1);
  const front = await page.locator('.facility-marker').evaluateAll(
    (markers, names) => {
      const pair = names.map((name) =>
        markers.find((marker) => marker.querySelector('button')!.ariaLabel!.startsWith(name + '（'))!,
      );
      for (const marker of pair) {
        if (!(marker instanceof HTMLElement)) throw new Error('ピンがHTML要素ではありません');
        marker.style.transform = 'translate(150px, 150px)';
        marker.parentElement!.append(marker);
      }
      const rect = pair[0].getBoundingClientRect();
      return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('button')?.ariaLabel;
    },
    [south.name, north.name],
  );
  expect(front).toContain(south.name);
});

test('閉じた詳細は別のカードを選んでから選び直すと再び開く', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.locator('.facility-marker')).toHaveCount(data.facilities.length);
  const [first, second] = data.facilities;
  const card = (id: string) => page.locator('article[data-facility-id="' + id + '"]');
  await card(first.id).getByRole('heading').click();
  await expect(page.getByRole('group', { name: '施設の詳細' })).toContainText(first.name);
  await page.getByRole('button', { name: 'Close popup' }).click();
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
    await expect(page.locator('.facility-marker')).toHaveCount(data.facilities.length);
    if (viewport.width === 390) await page.getByRole('button', { name: '地図', exact: true }).click();
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
