import {
  expectPinProbe,
  expectSelectedPinCount,
  homePinShown,
  pinCentre,
  clickPin,
  pixelColors,
  cssColor,
  renderedPins,
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
  const homePin = (await renderedPins(page)).find((pin) => pin.layer === 'home-pin')!;
  const east = (farthest.lng - home.lng) * Math.cos((home.lat * Math.PI) / 180);
  const north = farthest.lat - home.lat;
  const length = Math.hypot(east, north);
  // 自宅のピンの外側で、選んだ施設へ向かう破線の一部を切り出す。
  const ends = [30, 70].map((distance) => ({
    x: homePin.clientX + (east / length) * distance,
    y: homePin.clientY - (north / length) * distance,
  }));
  const left = Math.min(ends[0].x, ends[1].x) - 4;
  const top = Math.min(ends[0].y, ends[1].y) - 4;
  const pixels = await pixelColors(
    page,
    left,
    top,
    Math.ceil(Math.abs(ends[0].x - ends[1].x)) + 8,
    Math.ceil(Math.abs(ends[0].y - ends[1].y)) + 8,
  );
  const accent = await cssColor(page, '--accent');
  expect(
    pixels.some((pixel) => pixel.every((value, i) => Math.abs(value - accent[i]) <= 12)),
    '自宅から選んだ施設への破線が --accent で描かれる',
  ).toBe(true);
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
  const typeTrigger = filters.getByRole('button', { name: /^種別 / });
  const northFilter = filters.getByRole('group', { name: '種別', exact: true }).getByRole('button', {
    name: typeLabels[north.facilityType],
    exact: true,
  });
  const southFilter = filters.getByRole('group', { name: '種別', exact: true }).getByRole('button', {
    name: typeLabels[south.facilityType],
    exact: true,
  });
  await typeTrigger.click();
  await northFilter.click();
  await typeTrigger.click();
  await expect.poll(() => pinCentre(page, north.id)).toBeNull();
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  const southOnly = await capture();
  expect(both).toEqual(southOnly);
  await typeTrigger.click();
  await northFilter.click();
  await southFilter.click();
  await typeTrigger.click();
  await expect.poll(() => pinCentre(page, south.id)).toBeNull();
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  const northOnly = await capture();
  const labelColor = await cssColor(page, '--surface');
  const labelPixel = southOnly.findIndex(
    (color, index) =>
      color.every((c, i) => Math.abs(c - labelColor[i]) < 12) && northOnly[index].some((c, i) => Math.abs(c - color[i]) > 100),
  );
  expect(labelPixel).toBeGreaterThanOrEqual(0);
  await typeTrigger.click();
  await southFilter.click();
  await typeTrigger.click();
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

test('モバイルの地図モードではタブ位置を動かさず全幅表示で凡例を収め、自宅を描画範囲の中央に置く', async ({ page, context }) => {
  const home = { lat: 34.675, lng: 135.535 };
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: home.lat, longitude: home.lng });
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto('/');
  await page.getByRole('banner').getByRole('button', { name: '現在地', exact: true }).click();
  await waitForLocation(page);
  const tabsBefore = (await viewToggle(page).boundingBox())!;

  await viewToggle(page).getByRole('button', { name: '地図', exact: true }).click();
  await expectPinProbe(page);
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  await expect.poll(() => homePinShown(page)).toBe(true);

  const tabsAfter = (await viewToggle(page).boundingBox())!;
  expect(Math.abs(tabsAfter.y - tabsBefore.y)).toBeLessThan(1);
  expect(Math.abs(tabsAfter.height - tabsBefore.height)).toBeLessThan(1);

  const layout = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
    scrollY: window.scrollY,
  }));
  expect(layout.scrollY).toBe(0);
  expect(layout.scrollHeight).toBeGreaterThan(layout.innerHeight);

  const map = (await page.locator('.maplibregl-map').boundingBox())!;
  expect(map.x).toBe(0);
  expect(map.width).toBe(412);
  expect(Math.abs(map.height - (915 - tabsAfter.height))).toBeLessThan(2);

  const expectLegendInsideViewport = async () => {
    const mapBox = (await page.locator('.maplibregl-map').boundingBox())!;
    const legend = (await page.getByRole('group', { name: '地図の凡例' }).boundingBox())!;
    const attribution = (await page.locator('.maplibregl-ctrl-attrib').boundingBox())!;
    expect(legend.x).toBeGreaterThanOrEqual(0);
    expect(legend.x + legend.width).toBeLessThanOrEqual(412);
    expect(legend.y).toBeGreaterThanOrEqual(mapBox.y);
    expect(legend.y + legend.height).toBeLessThanOrEqual(915);
    expect(attribution.y + attribution.height).toBeLessThanOrEqual(915 + 1);
    expect(legend.y + legend.height).toBeLessThanOrEqual(attribution.y + 1);
  };
  await expectLegendInsideViewport();

  const expectHomeCentered = async () => {
    await expect
      .poll(async () => {
        const mapBox = (await page.locator('.maplibregl-map').boundingBox())!;
        const legend = (await page.getByRole('group', { name: '地図の凡例' }).boundingBox())!;
        const homePin = (await renderedPins(page)).find((pin) => pin.layer === 'home-pin');
        if (!homePin) return Number.POSITIVE_INFINITY;
        const targetX = mapBox.x + mapBox.width / 2;
        const targetY = (mapBox.y + legend.y) / 2;
        return Math.hypot(homePin.clientX - targetX, homePin.clientY - targetY);
      })
      .toBeLessThan(2);
  };
  await expectHomeCentered();

  const nearest = [...data.facilities].sort((a, b) => distanceMeters(home, a) - distanceMeters(home, b)).slice(0, 5);
  for (const facility of nearest) {
    await expect.poll(() => pinCentre(page, facility.id)).not.toBeNull();
  }

  // ヘッダー開閉ボタンでタブ位置までスクロールすると、自宅ピンが見えている範囲の中央に追従する。
  const headerToggle = viewToggle(page).getByRole('button', { name: /絞り込みとヘッダー/ });
  await expect(headerToggle).toHaveAttribute('aria-expanded', 'true');
  const pinBeforeCollapse = (await renderedPins(page)).find((pin) => pin.layer === 'home-pin')!;
  await headerToggle.click();
  await expect(headerToggle).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(async () => Math.abs((await viewToggle(page).boundingBox())!.y)).toBeLessThan(2);
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  await expectLegendInsideViewport();
  await expectHomeCentered();
  const pinWhileCollapsed = (await renderedPins(page)).find((pin) => pin.layer === 'home-pin')!;
  expect(pinWhileCollapsed.clientY).toBeLessThan(pinBeforeCollapse.clientY - 50);

  await headerToggle.click();
  await expect(headerToggle).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(2);
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  await expectLegendInsideViewport();
  await expectHomeCentered();

  // 地図モードで区の選択パネルを開いてもオーバーレイで表示され、地図の高さは変わらない。
  const wardTrigger = page.getByRole('region', { name: '絞り込み' }).getByRole('button', { name: /^区 / });
  await wardTrigger.click();
  await expect(page.getByRole('group', { name: '区', exact: true })).toBeVisible();
  const mapWhilePanelOpen = (await page.locator('.maplibregl-map').boundingBox())!;
  expect(Math.abs(mapWhilePanelOpen.height - map.height)).toBeLessThan(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('group', { name: '区', exact: true })).toHaveCount(0);

  // 手動ドラッグは自由にでき、リストへ戻してから再度地図を開くと自宅が中央に戻る。
  const dragX = map.x + map.width - 40;
  const dragY = (map.y + 915) / 2;
  await page.mouse.move(dragX, dragY);
  await page.mouse.down();
  await page.mouse.move(dragX - 150, dragY - 120, { steps: 15 });
  await page.waitForTimeout(200);
  await page.mouse.up();
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  const legendNow = (await page.getByRole('group', { name: '地図の凡例' }).boundingBox())!;
  const draggedPin = (await renderedPins(page)).find((pin) => pin.layer === 'home-pin')!;
  expect(
    Math.hypot(draggedPin.clientX - (map.x + map.width / 2), draggedPin.clientY - (map.y + legendNow.y) / 2),
  ).toBeGreaterThan(50);

  await viewToggle(page).getByRole('button', { name: 'リスト', exact: true }).click();
  await viewToggle(page).getByRole('button', { name: '地図', exact: true }).click();
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  await expectHomeCentered();
});

test('低い画面のモバイルでもタブ位置まで手動スクロールすると地図が広がり自宅が中央に追従する', async ({ page, context }) => {
  const home = { lat: 34.675, lng: 135.535 };
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: home.lat, longitude: home.lng });
  await page.setViewportSize({ width: 375, height: 550 });
  await page.goto('/');
  await page.getByRole('banner').getByRole('button', { name: '現在地', exact: true }).click();
  await waitForLocation(page);
  await viewToggle(page).getByRole('button', { name: '地図', exact: true }).click();
  await expectPinProbe(page);
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  await expect.poll(() => homePinShown(page)).toBe(true);

  const tabsBefore = (await viewToggle(page).boundingBox())!;
  const visibleBefore = 550 - (tabsBefore.y + tabsBefore.height);
  expect(visibleBefore).toBeLessThan(350);

  const expectHomeCentered = async () => {
    await expect
      .poll(async () => {
        const mapBox = (await page.locator('.maplibregl-map').boundingBox())!;
        const legend = (await page.getByRole('group', { name: '地図の凡例' }).boundingBox())!;
        const homePin = (await renderedPins(page)).find((pin) => pin.layer === 'home-pin');
        if (!homePin) return Number.POSITIVE_INFINITY;
        return Math.hypot(homePin.clientX - (mapBox.x + mapBox.width / 2), homePin.clientY - (mapBox.y + legend.y) / 2);
      })
      .toBeLessThan(2);
  };
  await expectHomeCentered();

  // 途中までスクロールしても中央に追従する。
  const maxScroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  expect(maxScroll).toBeGreaterThan(100);
  await page.evaluate((y) => window.scrollTo(0, y), Math.round(maxScroll / 2));
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  await expectHomeCentered();

  // タブが上端に張り付く位置までスクロールすると、地図領域が広がりボタン状態も連動する。
  await page.evaluate((y) => window.scrollTo(0, y), maxScroll);
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  const tabsCollapsed = (await viewToggle(page).boundingBox())!;
  expect(Math.abs(tabsCollapsed.y)).toBeLessThan(2);
  expect(550 - tabsCollapsed.height).toBeGreaterThan(visibleBefore + 100);
  await expect(viewToggle(page).getByRole('button', { name: /絞り込みとヘッダー/ })).toHaveAttribute('aria-expanded', 'false');
  await expectHomeCentered();
});

test('地図を動かしても自宅に戻るボタンで自宅と近い5施設が中央に戻る', async ({ page, context }) => {
  const home = { lat: 34.675, lng: 135.535 };
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: home.lat, longitude: home.lng });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expectPinProbe(page);
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');

  const mapRegion = page.getByRole('region', { name: '地図', exact: true });
  const homeButton = mapRegion.getByRole('button', { name: '自宅に戻る', exact: true });
  await expect(homeButton).toHaveCount(0);

  await page.getByRole('banner').getByRole('button', { name: '現在地', exact: true }).click();
  await waitForLocation(page);
  await expect.poll(() => homePinShown(page)).toBe(true);
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  await expect(homeButton).toBeVisible();

  const zoomOutBox = (await mapRegion.getByRole('button', { name: 'Zoom out', exact: true }).boundingBox())!;
  const homeBox = (await homeButton.boundingBox())!;
  expect(Math.abs(homeBox.x - zoomOutBox.x)).toBeLessThan(1);
  expect(Math.abs(homeBox.width - zoomOutBox.width)).toBeLessThan(1);
  expect(homeBox.y).toBeGreaterThan(zoomOutBox.y + zoomOutBox.height);

  const map = (await page.locator('.maplibregl-map').boundingBox())!;
  const legend = (await page.getByRole('group', { name: '地図の凡例' }).boundingBox())!;
  const expectHomeCentered = async () => {
    await expect
      .poll(async () => {
        const homePin = (await renderedPins(page)).find((pin) => pin.layer === 'home-pin');
        if (!homePin) return Number.POSITIVE_INFINITY;
        const targetX = map.x + map.width / 2;
        const targetY = (map.y + legend.y) / 2;
        return Math.hypot(homePin.clientX - targetX, homePin.clientY - targetY);
      })
      .toBeLessThan(2);
  };
  await expectHomeCentered();

  const dragX = map.x + map.width - 40;
  const dragY = map.y + map.height / 2;
  await page.mouse.move(dragX, dragY);
  await page.mouse.down();
  await page.mouse.move(dragX - 300, dragY - 200, { steps: 15 });
  await page.waitForTimeout(200);
  await page.mouse.up();
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  const draggedPin = (await renderedPins(page)).find((pin) => pin.layer === 'home-pin');
  expect(
    draggedPin
      ? Math.hypot(draggedPin.clientX - (map.x + map.width / 2), draggedPin.clientY - (map.y + legend.y) / 2)
      : Number.POSITIVE_INFINITY,
  ).toBeGreaterThan(100);

  await homeButton.click();
  await expect(ready(page)).toHaveAttribute('aria-busy', 'false');
  await expectHomeCentered();

  const nearest = [...data.facilities].sort((a, b) => distanceMeters(home, a) - distanceMeters(home, b)).slice(0, 5);
  for (const facility of nearest) {
    await expect.poll(() => pinCentre(page, facility.id)).not.toBeNull();
  }

  await page.getByRole('banner').getByRole('button', { name: '解除', exact: true }).click();
  await expect(homeButton).toHaveCount(0);
});
