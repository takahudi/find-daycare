import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import data from '../src/data/facilities.json' with { type: 'json' };
import type { RenderedPin } from '../src/features/map/pin-probe.ts';

export function viewToggle(page: Page) {
  return page.getByRole('navigation', { name: '表示切替' });
}
export async function expectPinProbe(page: Page) {
  await page.waitForFunction(() => window.__findDaycarePins !== undefined);
}
export async function renderedPins(page: Page): Promise<RenderedPin[]> {
  await expectPinProbe(page);
  return page.evaluate(() => window.__findDaycarePins!.rendered());
}
export async function expectFacilityPinCount(page: Page, count: number) {
  await expect
    .poll(
      async () =>
        (await renderedPins(page)).filter((pin) => pin.layer === 'facility-pins-full' || pin.layer === 'facility-pins-open')
          .length,
    )
    .toBe(count);
}
export async function expectSelectedPinCount(page: Page, count: 0 | 1) {
  await expect
    .poll(async () => (await renderedPins(page)).filter((pin) => pin.layer === 'facility-pin-selected').length)
    .toBe(count);
}
export async function homePinShown(page: Page): Promise<boolean> {
  return (await renderedPins(page)).some((pin) => pin.layer === 'home-pin');
}
export async function pinCentre(page: Page, id: string): Promise<{ x: number; y: number } | null> {
  const pins = await renderedPins(page);
  const pin =
    pins.find((candidate) => candidate.key === id && candidate.layer === 'facility-pin-selected') ??
    pins.find((candidate) => candidate.key === id);
  return pin ? { x: pin.clientX, y: pin.clientY } : null;
}
export async function pinClickPoint(page: Page, id: string) {
  const centre = await pinCentre(page, id);
  if (!centre) return null;
  return page.evaluate(
    ({ facilityId, centre: pointCentre }) => {
      const probe = window.__findDaycarePins!;
      const canvas = document.querySelector('canvas.maplibregl-canvas');
      for (const radius of [0, 4, 8, 12, 16]) {
        for (let angle = 0; angle < 360; angle += 45) {
          const x = pointCentre.x + radius * Math.cos((angle * Math.PI) / 180);
          const y = pointCentre.y + radius * Math.sin((angle * Math.PI) / 180);
          if (document.elementFromPoint(x, y) === canvas && probe.pick(x, y) === facilityId) return { x, y };
        }
      }
      return null;
    },
    { facilityId: id, centre },
  );
}
export async function clickPin(page: Page, id: string) {
  await expectPinProbe(page);
  const point = await pinClickPoint(page, id);
  if (!point) throw new Error(`施設 ${id} のピンが地図に描かれていないか、他のピンや部品に隠れている`);
  await page.mouse.click(point.x, point.y);
}
export async function zoomToPin(page: Page, id: string) {
  await expect.poll(() => pinCentre(page, id)).not.toBeNull();
  for (let step = 0; step < 12 && !(await pinClickPoint(page, id)); step++) {
    const point = (await pinCentre(page, id))!;
    await page.mouse.move(point.x, point.y);
    await page.mouse.wheel(0, -1200);
    await page.waitForTimeout(350);
    await expect(page.locator('[aria-busy]:has(> .maplibregl-map)')).toHaveAttribute('aria-busy', 'false');
  }
  await expect.poll(() => pinClickPoint(page, id)).not.toBeNull();
}
export async function pixelAt(page: Page, x: number, y: number): Promise<[number, number, number]> {
  const png = await page.screenshot({ clip: { x: Math.floor(x), y: Math.floor(y), width: 1, height: 1 }, scale: 'css' });
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const rgba = context.getImageData(0, 0, 1, 1).data;
    return [rgba[0], rgba[1], rgba[2]];
  }, png.toString('base64'));
}
export async function mapAxe(page: Page, selectors: string[] = []) {
  const builder = new AxeBuilder({ page });
  for (const selector of selectors) builder.include(selector);
  return [await builder.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze()];
}
export function mapContrastSummary(results: Awaited<ReturnType<typeof mapAxe>>) {
  return results.flatMap((result) =>
    result.incomplete
      .filter((rule) => rule.id === 'color-contrast')
      .flatMap((rule) => rule.nodes.map((node) => ({ target: node.target, reason: node.failureSummary }))),
  );
}
export async function expectPinShapes(page: Page, licensing: 'licensed' | 'unlicensed') {
  await expect
    .poll(async () =>
      (await renderedPins(page)).some(
        (pin) => pin.face.kind === 'facility' && pin.face.shape === (licensing === 'licensed' ? 'circle' : 'square'),
      ),
    )
    .toBe(true);
  const pins = (await renderedPins(page)).filter((pin) => pin.layer.startsWith('facility-pins-'));
  const matching = pins.filter((pin) => data.facilities.find((facility) => facility.id === pin.key)!.licensing === licensing);
  expect(matching.length).toBeGreaterThan(0);
  for (const pin of matching) expect(pin.face).toMatchObject({ shape: licensing === 'licensed' ? 'circle' : 'square' });
}
export async function openVisibleUnlicensedPopup(page: Page) {
  const pins = (await renderedPins(page)).filter((pin) => pin.face.kind === 'facility' && pin.face.shape === 'square');
  for (const pin of pins) {
    if (!(await pinClickPoint(page, pin.key))) continue;
    await clickPin(page, pin.key);
    await expect(page.locator('.maplibregl-popup')).toHaveCount(1);
    await expect(page.locator('.maplibregl-popup')).toHaveCSS('opacity', '1');
    return;
  }
  throw new Error('地図内に操作できる認可外ピンがない');
}

export async function pixelColors(page: Page, x: number, y: number, width: number, height: number): Promise<number[][]> {
  const png = await page.screenshot({ clip: { x: Math.floor(x), y: Math.floor(y), width, height }, scale: 'css' });
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + base64;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const rgba = context.getImageData(0, 0, image.width, image.height).data;
    return Array.from({ length: image.width * image.height }, (_, i) => Array.from(rgba.slice(i * 4, i * 4 + 3)));
  }, png.toString('base64'));
}
