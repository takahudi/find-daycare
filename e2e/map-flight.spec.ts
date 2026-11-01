import {
  expectPinProbe,
  expectSelectedPinCount,
  homePinShown,
  pinCentre,
  clickPin,
  renderedPins,
  expectFacilityPinCount,
  pixelAt,
  cssColor,
} from './map.ts';
import { viewToggle } from './map.ts';
import { setTimeout as delayResponse } from 'node:timers/promises';
import { waitForLocation } from './location.ts';
import { expect, test, type Page } from '@playwright/test';
import data from '../src/data/facilities.json' with { type: 'json' };
import { POPUP_OFFSET } from '../src/features/map/FacilityPopup.tsx';
import { distanceMeters } from '../src/lib/geo.ts';
import { pinGeometry } from '../src/features/map/pin-face.ts';

const ready = (page: Page) => page.locator('[aria-busy]:has(> .maplibregl-map)');
const facilityId = 'taisho-82305';
async function freeze(page: Page) {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
}
async function openMap(page: Page, mobile = false) {
  await page.goto('/');
  await expectPinProbe(page);
  if (mobile) await viewToggle(page).getByRole('button', { name: '地図', exact: true }).click();
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
}
const geometry = (page: Page) =>
  page.evaluate((offset) => {
    const map = document.querySelector('.maplibregl-map')!.getBoundingClientRect();
    const popup = document.querySelector('.maplibregl-popup')!.getBoundingClientRect();
    const tip = document.querySelector('.maplibregl-popup-tip')!.getBoundingClientRect();
    const pin = window.__findDaycarePins!.rendered().find((candidate) => candidate.layer === 'facility-pin-selected');
    if (!pin) throw new Error('選択ピンが描画されていない');
    const marker = { x: pin.clientX, y: pin.clientY, top: pin.clientY, width: 0, height: 0 };
    const popupAnchor = { x: tip.x + tip.width / 2, y: tip.bottom + offset };
    return { map: map.toJSON(), popup: popup.toJSON(), marker, popupAnchor };
  }, POPUP_OFFSET);
async function expectInside(page: Page) {
  await expect
    .poll(async () => {
      const { map, popup } = await geometry(page);
      return popup.top >= map.top && popup.bottom <= map.bottom && popup.left >= map.left && popup.right <= map.right;
    })
    .toBe(true);
  const { marker, popupAnchor } = await geometry(page);
  expect(Math.hypot(marker.x - popupAnchor.x, marker.y - popupAnchor.y)).toBeLessThan(1);
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
    await viewToggle(page).getByRole('button', { name: 'リスト', exact: true }).click();
    await freeze(page);
    await page
      .locator(`article[data-facility-id="${facilityId}"]`)
      .getByRole('button', { name: '地図で見る' })
      .evaluate((el) => {
        if (el instanceof HTMLElement) el.click();
      });
    await expect(page.locator('.maplibregl-popup')).toBeVisible();
    await page.clock.runFor(delay);
    await viewToggle(page)
      .getByRole('button', { name: 'リスト', exact: true })
      .evaluate((el) => {
        if (el instanceof HTMLElement) el.click();
      });
    await page.clock.runFor(1000);
    await viewToggle(page)
      .getByRole('button', { name: '地図', exact: true })
      .evaluate((el) => {
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
    await expectPinProbe(page);
    if (viewport.width === 390) await viewToggle(page).getByRole('button', { name: '地図', exact: true }).click();
    await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
    await expectInside(page);
  });
}

test('同じ施設の詳細を開き直すと画面外にずらしたポップアップが地図内に収まる', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 500 });
  await page.goto('/?facility=' + facilityId);
  await expectPinProbe(page);
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
  await clickPin(page, facilityId);
  await expect(page.locator('.maplibregl-popup')).toHaveCount(0);
  await clickPin(page, facilityId);
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
    await page.setViewportSize({ width: 1280, height: 800 });
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
      await page
        .getByRole('banner')
        .getByRole('button', { name: '現在地', exact: true })
        .evaluate((el) => {
          if (el instanceof HTMLElement) el.click();
        });
      await waitForLocation(page);
      await expect
        .poll(async () => {
          await page.clock.runFor(200);
          return homePinShown(page);
        })
        .toBe(true);
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
      const { map, popup, marker } = await geometry(page);
      expect(map.height, '現在地付きの詳細とピンが収まる地図の高さ').toBeGreaterThan(popup.height + POPUP_OFFSET);
      await expectInside(page);
      expect(Math.abs(marker.x + marker.width / 2 - (map.x + map.width / 2))).toBeLessThan(1);
      await expect.poll(() => homePinShown(page)).toBe(false);
    } else {
      await expect.poll(() => homePinShown(page)).toBe(true);
      for (const facility of [...data.facilities].sort((a, b) => distanceMeters(home, a) - distanceMeters(home, b)).slice(0, 5)) {
        await expect.poll(() => pinCentre(page, facility.id)).not.toBeNull();
      }
    }
  });
}

test('地図より高い詳細は上端の余白を優先する', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 130 });
  await page.goto('/?facility=' + facilityId);
  await expectPinProbe(page);
  await viewToggle(page).getByRole('button', { name: '地図', exact: true }).click();
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  const map = await page.locator('.maplibregl-map').evaluate((element) => element.getBoundingClientRect().toJSON());
  const popup = await page.locator('.maplibregl-popup').evaluate((element) => element.getBoundingClientRect().toJSON());
  expect(popup.height).toBeGreaterThan(map.height);
  expect(Math.abs(popup.top - map.top - 8)).toBeLessThan(1);
});

test('非表示だった地図へ移ると実際の高さに合わせた位置へ飛行する', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMap(page, true);
  await viewToggle(page).getByRole('button', { name: 'リスト', exact: true }).click();
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
  await page.getByRole('banner').getByRole('button', { name: '現在地', exact: true }).click();
  await waitForLocation(page);
}

test('保留中の施設選択は自宅を解除しても地図の表示時に実行される', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: homeForPending.lat, longitude: homeForPending.lng });
  await page.setViewportSize({ width: 390, height: 844 });
  await openMap(page, true);
  await viewToggle(page).getByRole('button', { name: 'リスト', exact: true }).click();
  await locateWhileHidden(page);
  await page.locator(`article[data-facility-id="${hiddenFacility.id}"]`).getByRole('heading').click();
  await page.getByRole('banner').getByRole('button', { name: '解除', exact: true }).click();
  await viewToggle(page).getByRole('button', { name: '地図', exact: true }).click();
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
  await viewToggle(page).getByRole('button', { name: 'リスト', exact: true }).click();
  await page.locator(`article[data-facility-id="${hiddenFacility.id}"]`).getByRole('button', { name: '地図で見る' }).click();
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  await viewToggle(page).getByRole('button', { name: 'リスト', exact: true }).click();
  await locateWhileHidden(page);
  await page.getByRole('region', { name: '絞り込み' }).getByRole('button', { name: '0歳', exact: true }).click();
  await expectSelectedPinCount(page, 0);
  await viewToggle(page).getByRole('button', { name: '地図', exact: true }).click();
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  await viewToggle(page).evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await expect.poll(() => homePinShown(page)).toBe(true);
  // 範囲は絞り込む前の近い5施設で決まる。0歳の絞り込みで消えたピンは確かめられない。
  const nearest = [...data.facilities]
    .sort((a, b) => distanceMeters(homeForPending, a) - distanceMeters(homeForPending, b))
    .slice(0, 5)
    .filter((facility) => facility.vacancies[0] !== null);
  expect(nearest.length, '近い5施設に0歳を受け入れる施設がある').toBeGreaterThan(0);
  for (const facility of nearest) {
    await expect.poll(() => pinCentre(page, facility.id)).not.toBeNull();
  }
});

test('保留中の自宅の範囲合わせは自宅を解除すると破棄される', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: homeForPending.lat, longitude: homeForPending.lng });
  await page.setViewportSize({ width: 390, height: 844 });
  await openMap(page, true);
  const viewport = async () => (await renderedPins(page)).filter((pin) => pin.layer.startsWith('facility-pins-')).length;
  const before = await viewport();
  await viewToggle(page).getByRole('button', { name: 'リスト', exact: true }).click();
  await locateWhileHidden(page);
  await page.getByRole('banner').getByRole('button', { name: '解除', exact: true }).click();
  await viewToggle(page).getByRole('button', { name: '地図', exact: true }).click();
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  await expect.poll(() => homePinShown(page)).toBe(false);
  expect(await viewport()).toBe(before);
});

test('保留中の施設を絞り込みで隠すとその施設への移動は破棄される', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMap(page, true);
  const probe = data.facilities.find((facility) => facility.vacancies[0] !== null)!;
  const position = async () => {
    const point = await pinCentre(page, probe.id);
    const map = (await page.locator('.maplibregl-map').boundingBox())!;
    return point ? { x: point.x - map.x, y: point.y - map.y } : null;
  };
  await expect.poll(position).not.toBeNull();
  const before = (await position())!;
  await viewToggle(page).getByRole('button', { name: 'リスト', exact: true }).click();
  await page.locator(`article[data-facility-id="${hiddenFacility.id}"]`).getByRole('heading').click();
  await page.getByRole('region', { name: '絞り込み' }).getByRole('button', { name: '0歳', exact: true }).click();
  await expectSelectedPinCount(page, 0);
  await viewToggle(page).getByRole('button', { name: '地図', exact: true }).click();
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  await expect.poll(position).not.toBeNull();
  const after = (await position())!;
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(1);
});

test('非表示の間に WebGL が復元されても地図で見る施設が中央に来る', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMap(page, true);
  await expectFacilityPinCount(page, data.facilities.length);
  await viewToggle(page).getByRole('button', { name: 'リスト', exact: true }).click();
  const extension = await page.evaluateHandle(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.maplibregl-canvas')!;
    canvas.addEventListener('webglcontextlost', () => Object.assign(window, { contextLost: true }), { once: true });
    canvas.addEventListener('webglcontextrestored', () => Object.assign(window, { contextRestored: true }), { once: true });
    return canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context')!;
  });
  await extension.evaluate((lose) => lose.loseContext());
  await page.waitForFunction(() => 'contextLost' in window);
  // すぐに戻すと、Chromium は非表示のキャンバスの復元を表示まで遅らせる。
  await page.waitForTimeout(1000);
  await extension.evaluate((lose) => lose.restoreContext());
  await page.waitForFunction(() => 'contextRestored' in window, null, { timeout: 20_000 });
  await page.locator(`article[data-facility-id="${facilityId}"]`).getByRole('button', { name: '地図で見る' }).click();
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
  await expectSelectedPinCount(page, 1);
  const { marker } = await geometry(page);
  await page.getByRole('region', { name: '地図', exact: true }).getByRole('button', { name: 'Close popup' }).click();
  const selected = (await renderedPins(page)).find((pin) => pin.layer === 'facility-pin-selected')!;
  const g = pinGeometry(selected.face, 'map');
  const color = await pixelAt(page, marker.x, marker.y + g.scale * (g.box / 2 + g.ring / 2));
  const accent = await cssColor(page, '--accent');
  expect(color.every((channel, index) => Math.abs(channel - accent[index]) < 20)).toBe(true);
  const zoomOut = page.getByRole('region', { name: '地図', exact: true }).getByRole('button', { name: 'Zoom out' });
  for (let step = 0; step < 5; step++) {
    await zoomOut.click();
    await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  }
  await expectFacilityPinCount(page, data.facilities.length);
  await expectSelectedPinCount(page, 1);
});
