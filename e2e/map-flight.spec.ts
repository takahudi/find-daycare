import { setTimeout as delayResponse } from 'node:timers/promises';
import { waitForLocation } from './location.ts';
import { expect, test, type Page } from '@playwright/test';
import data from '../src/data/facilities.json' with { type: 'json' };
import { distanceMeters } from '../src/lib/geo.ts';

const ready = (page: Page) => page.locator('[aria-busy]:has(> .maplibregl-map)');
const facilityId = 'taisho-82305';
async function freeze(page: Page) {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
}
async function openMap(page: Page, mobile = false) {
  await page.goto('/');
  await expect(page.locator('.facility-marker')).toHaveCount(data.facilities.length);
  if (mobile) await page.getByRole('button', { name: '地図', exact: true }).click();
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
}
const geometry = (page: Page) =>
  page.evaluate(() => {
    const map = document.querySelector('.maplibregl-map')!.getBoundingClientRect();
    const popup = document.querySelector('.maplibregl-popup')!.getBoundingClientRect();
    const marker = document.querySelector('.facility-marker:has(.pin--selected)')!.getBoundingClientRect();
    return { map: map.toJSON(), popup: popup.toJSON(), marker: marker.toJSON() };
  });
async function expectInside(page: Page) {
  await expect
    .poll(async () => {
      const { map, popup } = await geometry(page);
      return popup.top >= map.top && popup.bottom <= map.bottom && popup.left >= map.left && popup.right <= map.right;
    })
    .toBe(true);
}

for (const delay of [100, 250, 400]) {
  test(`飛行${delay}msで地図をつかんでもポップアップとピンが跳ねない`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 500 });
    await openMap(page);
    await freeze(page);
    await page
      .locator(`article[data-facility-id="${facilityId}"]`)
      .getByRole('heading')
      .evaluate((el) => {
        if (el instanceof HTMLElement) el.click();
      });
    await expect(page.locator('.maplibregl-popup')).toBeVisible();
    await page.clock.runFor(delay);
    const before = await geometry(page);
    const x = before.map.right - 25,
      y = before.map.bottom - 60;
    await page.mouse.move(x, y);
    await page.mouse.down();
    const down = await geometry(page);
    expect(Math.hypot(down.popup.x - before.popup.x, down.popup.y - before.popup.y)).toBeLessThan(1);
    expect(Math.hypot(down.marker.x - before.marker.x, down.marker.y - before.marker.y)).toBeLessThan(1);
    await page.mouse.move(x - 80, y, { steps: 8 });
    await page.clock.runFor(200);
    await page.mouse.up();
    await page.clock.runFor(1000);
    const after = await geometry(page);
    expect(Math.abs(after.marker.x - (down.marker.x - 80))).toBeLessThan(1);
  });

  test(`飛行${delay}msでリストに切り替えて戻しても詳細が地図内に収まる`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 250 });
    await openMap(page, true);
    await page.getByRole('button', { name: 'リスト', exact: true }).click();
    await freeze(page);
    await page
      .locator(`article[data-facility-id="${facilityId}"]`)
      .getByRole('button', { name: '地図で見る' })
      .evaluate((el) => {
        if (el instanceof HTMLElement) el.click();
      });
    await expect(page.locator('.maplibregl-popup')).toBeVisible();
    await page.clock.runFor(delay);
    await page.getByRole('button', { name: 'リスト', exact: true }).evaluate((el) => {
      if (el instanceof HTMLElement) el.click();
    });
    await page.clock.runFor(1000);
    await page.getByRole('button', { name: '地図', exact: true }).evaluate((el) => {
      if (el instanceof HTMLElement) el.click();
    });
    await page.clock.runFor(1000);
    await expectInside(page);
  });
}

for (const viewport of [
  { width: 1280, height: 500 },
  { width: 390, height: 250 },
]) {
  test(`動きを減らす設定でも初期選択の詳細が地図内に収まる ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize(viewport);
    await page.goto('/?facility=' + facilityId);
    await expect(page.locator('.facility-marker')).toHaveCount(data.facilities.length);
    if (viewport.width === 390) await page.getByRole('button', { name: '地図', exact: true }).click();
    await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
    await expectInside(page);
  });
}

test('同じ施設の詳細を開き直すと画面外にずらしたポップアップが地図内に収まる', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 500 });
  await page.goto('/?facility=' + facilityId);
  await expect(page.locator('.facility-marker')).toHaveCount(data.facilities.length);
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  await expectInside(page);
  const { map } = await geometry(page);
  const x = map.right - 25,
    y = map.top + map.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 60, { steps: 10 });
  await page.waitForTimeout(200);
  await page.mouse.up();
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  expect((await geometry(page)).popup.top).toBeLessThan(map.top);
  const pin = page.locator('.facility-marker:has(.pin--selected) button');
  await pin.evaluate((el) => {
    if (el instanceof HTMLElement) el.click();
  });
  await expect(page.locator('.maplibregl-popup')).toHaveCount(0);
  await pin.evaluate((el) => {
    if (el instanceof HTMLElement) el.click();
  });
  await expectInside(page);
});

for (const last of ['facility', 'home']) {
  test(`タイルが遅れても自宅と施設を続けて選ぶと最後の${last === 'home' ? '自宅の範囲合わせ' : '施設選択'}が優先される`, async ({
    page,
    context,
  }) => {
    const home = { lat: 34.6937, lng: 135.5023 };
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: home.lat, longitude: home.lng });
    await page.setViewportSize({ width: 1280, height: 500 });
    await openMap(page);
    await page.route('**/map/tiles/**', async (route) => {
      await delayResponse(2000);
      await route.continue();
    });
    await freeze(page);
    const farthest = [...data.facilities].sort((a, b) => distanceMeters(home, b) - distanceMeters(home, a))[0];
    const select = () =>
      page
        .locator(`article[data-facility-id="${farthest.id}"]`)
        .getByRole('heading')
        .evaluate((el) => {
          if (el instanceof HTMLElement) el.click();
        });
    const locate = async () => {
      await page.getByRole('button', { name: '現在地', exact: true }).evaluate((el) => {
        if (el instanceof HTMLElement) el.click();
      });
      await waitForLocation(page);
      await expect(page.locator('.maplibregl-marker .pin--home')).toHaveCount(1);
    };
    if (last === 'facility') {
      await locate();
      await page.clock.runFor(100);
      await select();
    } else {
      await select();
      await page.clock.runFor(100);
      await locate();
    }
    await page.clock.runFor(1500);
    await page.clock.resume();
    await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
    if (last === 'facility') {
      await expectInside(page);
      const { map, marker } = await geometry(page);
      expect(Math.abs(marker.x + marker.width / 2 - (map.x + map.width / 2))).toBeLessThan(1);
      await expect(page.locator('.maplibregl-marker:has(.pin--home)')).not.toBeInViewport();
    } else {
      await expect(page.locator('.maplibregl-marker:has(.pin--home)')).toBeInViewport();
      for (const facility of [...data.facilities].sort((a, b) => distanceMeters(home, a) - distanceMeters(home, b)).slice(0, 5)) {
        await expect(
          page
            .locator('.facility-marker')
            .filter({ has: page.getByRole('button', { name: facility.name + '（', exact: false }) }),
        ).toBeInViewport();
      }
    }
  });
}

test('地図より高い詳細は上端の余白を優先する', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 130 });
  await page.goto('/?facility=' + facilityId);
  await expect(page.locator('.facility-marker')).toHaveCount(data.facilities.length);
  await page.getByRole('button', { name: '地図', exact: true }).click();
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  const { map, popup } = await geometry(page);
  expect(popup.height).toBeGreaterThan(map.height);
  expect(Math.abs(popup.top - map.top - 8)).toBeLessThan(1);
});

test('非表示だった地図へ移ると実際の高さに合わせた位置へ飛行する', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMap(page, true);
  await page.getByRole('button', { name: 'リスト', exact: true }).click();
  await page.locator('article[data-facility-id="kita-13311"]').getByRole('button', { name: '地図で見る' }).click();
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  await expect
    .poll(async () => {
      const { map, marker } = await geometry(page);
      return Math.abs(marker.top + marker.height / 2 - map.top - map.height / 2);
    })
    .toBeLessThan(1);
  await expectInside(page);
});
const homeForPending = { lat: 34.6937, lng: 135.5023 };
const hiddenFacility = [...data.facilities]
  .filter((facility) => facility.vacancies[0] === null)
  .sort((a, b) => distanceMeters(homeForPending, b) - distanceMeters(homeForPending, a))[0];

async function locateWhileHidden(page: Page) {
  await page.getByRole('button', { name: '現在地', exact: true }).click();
  await waitForLocation(page);
}

test('保留中の施設選択は自宅を解除しても地図の表示時に実行される', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: homeForPending.lat, longitude: homeForPending.lng });
  await page.setViewportSize({ width: 390, height: 844 });
  await openMap(page, true);
  await page.getByRole('button', { name: 'リスト', exact: true }).click();
  await locateWhileHidden(page);
  await page.locator(`article[data-facility-id="${hiddenFacility.id}"]`).getByRole('heading').click();
  await page.getByRole('button', { name: '解除', exact: true }).click();
  await page.getByRole('button', { name: '地図', exact: true }).click();
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  await expect
    .poll(async () => {
      const { map, marker } = await geometry(page);
      return Math.hypot(
        marker.x + marker.width / 2 - map.x - map.width / 2,
        marker.y + marker.height / 2 - map.y - map.height / 2,
      );
    })
    .toBeLessThan(1);
  await expectInside(page);
});

test('保留中の自宅の範囲合わせは選択施設を絞り込みで隠しても地図の表示時に実行される', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: homeForPending.lat, longitude: homeForPending.lng });
  await page.setViewportSize({ width: 390, height: 844 });
  await openMap(page, true);
  await page.getByRole('button', { name: 'リスト', exact: true }).click();
  await page.locator(`article[data-facility-id="${hiddenFacility.id}"]`).getByRole('button', { name: '地図で見る' }).click();
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'リスト', exact: true }).click();
  await locateWhileHidden(page);
  await page.getByRole('button', { name: '0歳', exact: true }).click();
  await expect(page.locator('.pin--selected')).toHaveCount(0);
  await page.getByRole('button', { name: '地図', exact: true }).click();
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('navigation', { name: '表示切替' }).evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await expect(page.locator('.maplibregl-marker:has(.pin--home)')).toBeInViewport();
  // 範囲は絞り込む前の近い5施設で決まる。0歳の絞り込みで消えたピンは確かめられない。
  const nearest = [...data.facilities]
    .sort((a, b) => distanceMeters(homeForPending, a) - distanceMeters(homeForPending, b))
    .slice(0, 5)
    .filter((facility) => facility.vacancies[0] !== null);
  expect(nearest.length, '近い5施設に0歳を受け入れる施設がある').toBeGreaterThan(0);
  for (const facility of nearest) {
    await expect(
      page.locator('.facility-marker').filter({ has: page.getByRole('button', { name: facility.name + '（', exact: false }) }),
    ).toBeInViewport();
  }
});

test('保留中の自宅の範囲合わせは自宅を解除すると破棄される', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: homeForPending.lat, longitude: homeForPending.lng });
  await page.setViewportSize({ width: 390, height: 844 });
  await openMap(page, true);
  const viewport = () =>
    page.evaluate(() => {
      const map = document.querySelector('.maplibregl-map')!.getBoundingClientRect();
      return [...document.querySelectorAll('.facility-marker')].filter((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.right > map.left && bounds.left < map.right && bounds.bottom > map.top && bounds.top < map.bottom;
      }).length;
    });
  const before = await viewport();
  await page.getByRole('button', { name: 'リスト', exact: true }).click();
  await locateWhileHidden(page);
  await page.getByRole('button', { name: '解除', exact: true }).click();
  await page.getByRole('button', { name: '地図', exact: true }).click();
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.maplibregl-marker:has(.pin--home)')).toHaveCount(0);
  expect(await viewport()).toBe(before);
});

test('保留中の施設を絞り込みで隠すとその施設への移動は破棄される', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMap(page, true);
  const probe = data.facilities.find((facility) => facility.vacancies[0] !== null)!;
  const marker = page
    .locator('.facility-marker')
    .filter({ has: page.getByRole('button', { name: probe.name + '（', exact: false }) });
  const position = () =>
    marker.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const map = document.querySelector('.maplibregl-map')!.getBoundingClientRect();
      return { x: bounds.x - map.x, y: bounds.y - map.y };
    });
  const before = await position();
  await page.getByRole('button', { name: 'リスト', exact: true }).click();
  await page.locator(`article[data-facility-id="${hiddenFacility.id}"]`).getByRole('heading').click();
  await page.getByRole('button', { name: '0歳', exact: true }).click();
  await expect(page.locator('.pin--selected')).toHaveCount(0);
  await page.getByRole('button', { name: '地図', exact: true }).click();
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  const after = await position();
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(1);
});
