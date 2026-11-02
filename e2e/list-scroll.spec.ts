import { expectFacilityPinCount, clickPin, zoomToPin } from './map.ts';
import { expect, test, type Page } from '@playwright/test';
import data from '../src/data/facilities.json' with { type: 'json' };

async function waitForFrames(page: Page, count = 30) {
  await page.evaluate(async (frameCount) => {
    for (let frame = 0; frame < frameCount; frame++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  }, count);
}

for (const { viewport, id } of [
  { viewport: { width: 1280, height: 800 }, id: 'tsurumi-184308' },
  { viewport: { width: 1920, height: 1080 }, id: 'tsurumi-184308' },
  { viewport: { width: 2560, height: 1440 }, id: 'tsurumi-184308' },
  { viewport: { width: 2560, height: 1440 }, id: 'nishi-kigyo-01' },
]) {
  test(`${viewport.width}px: ピンで選んだ遠い施設 ${id} のカード全体が描画後も表示される`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.route('**/__scroll-test.css', (route) =>
      route.fulfill({
        contentType: 'text/css',
        body: 'article[data-facility-id]{contain-intrinsic-height:auto 100px !important}',
      }),
    );
    await page.addStyleTag({ url: '/__scroll-test.css' });
    const cards = page.locator('article[data-facility-id]');
    await expect(cards).toHaveCount(data.facilities.length);
    await expect(page.locator('[aria-busy]:has(> .maplibregl-map)')).toHaveAttribute('aria-busy', 'false');
    const order = await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-facility-id')));
    expect(order.indexOf(id)).toBeGreaterThanOrEqual(Math.floor(order.length / 2));
    const facility = data.facilities.find((candidate) => candidate.id === id);
    if (!facility) throw new Error('回帰検証で選ぶ施設 ' + id + ' がデータに存在しない');
    await expectFacilityPinCount(page, data.facilities.length);
    await zoomToPin(page, id);
    await clickPin(page, id);
    const selected = page.locator('article[aria-current="true"]');
    await expect(selected).toHaveCount(1);
    await expect(selected).toHaveAttribute('data-facility-id', id);
    await waitForFrames(page);
    await expect(selected).toBeInViewport({ ratio: 0.99 });
    await expect(page.getByRole('group', { name: '施設の詳細' })).toContainText(facility.name);
    await waitForFrames(page);
    await expect(selected).toBeInViewport({ ratio: 0.99 });
  });
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
]) {
  test(`${viewport.width}px: 初期 URL の鶴見区の施設のカード全体へ移動する`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/?facility=tsurumi-184308');
    const selected = page.locator('article[aria-current="true"]');
    await expect(selected).toHaveCount(1);
    await expect(selected).toHaveAttribute('data-facility-id', 'tsurumi-184308');
    await expect(page.locator('[aria-busy]:has(> .maplibregl-map)')).toHaveAttribute('aria-busy', 'false');
    await waitForFrames(page);
    await expect(selected).toBeInViewport({ ratio: 0.99 });
    await waitForFrames(page);
    await expect(selected).toBeInViewport({ ratio: 0.99 });
  });
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
]) {
  test(viewport.width + 'px: カード上のホイールによる一覧のスクロールを巻き戻さない', async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.locator('article[data-facility-id]')).toHaveCount(data.facilities.length);
    await expect(page.locator('[aria-busy]:has(> .maplibregl-map)')).toHaveAttribute('aria-busy', 'false');
    const facility = data.facilities.find((candidate) => candidate.id === 'tsurumi-184308');
    if (!facility) throw new Error('回帰検証で選ぶ施設 tsurumi-184308 がデータに存在しない');
    const pane = await page.getByRole('region', { name: '施設一覧', exact: true }).boundingBox();
    if (!pane) throw new Error('施設一覧の表示領域がない');
    await page.mouse.move(pane.x + pane.width * 0.25, pane.y + pane.height * 0.8);
    await expectFacilityPinCount(page, data.facilities.length);
    await zoomToPin(page, facility.id);
    const observation = page.evaluate(async () => {
      let trusted = false;
      let overCard = false;
      window.addEventListener(
        'wheel',
        (event) => {
          trusted = event.isTrusted;
          overCard = event.target instanceof Element && event.target.closest('article[data-facility-id]') !== null;
        },
        { once: true, capture: true },
      );
      await new Promise<void>((resolve) => window.addEventListener('wheel', () => resolve(), { once: true }));
      for (let frame = 0; frame < 35; frame++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return { trusted, overCard };
    });
    await clickPin(page, facility.id);
    await page.mouse.move(pane.x + pane.width * 0.25, pane.y + pane.height * 0.8);
    await page.mouse.wheel(0, -600);
    const result = await observation;
    await test.info().attach('wheel-scroll', { body: JSON.stringify(result), contentType: 'application/json' });
    expect(result.trusted).toBe(true);
    expect(result.overCard, 'カード上でホイール入力を受け取る').toBe(true);
    await expect(page.locator('article[aria-current="true"]')).not.toBeInViewport();
  });
}
