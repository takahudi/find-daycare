import { expect, test } from '@playwright/test';
import { expectSelectedPinCount, pixelAt } from './map.ts';

for (const id of ['higashiyodogawa-133106', 'kita-13311', 'nishi-kigyo-01']) {
  for (const zoom of [15, 17]) {
    test(`z${zoom} ${id}の描画中心と当たりの中心が0.5px以内で、見えるピンをマウスで選べる`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto('/?facility=' + id);
      await expectSelectedPinCount(page, 1);
      const region = page.getByRole('region', { name: '地図', exact: true });
      await expect(page.locator('[aria-busy]:has(> .maplibregl-map)')).toHaveAttribute('aria-busy', 'false');
      await region.getByRole('button', { name: 'Close popup' }).click();
      for (let step = 15; step < zoom; step++) {
        await region.getByRole('button', { name: 'Zoom in' }).click();
        await expect(page.locator('[aria-busy]:has(> .maplibregl-map)')).toHaveAttribute('aria-busy', 'false');
      }
      if (zoom === 17) await expect(region.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
      await expect(page.locator('[aria-busy]:has(> .maplibregl-map)')).toHaveAttribute('aria-busy', 'false');
      await page.evaluate(() => {
        history.pushState({}, '', '/');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await expectSelectedPinCount(page, 0);
      const samples = await page.evaluate((facilityId) => {
        const probe = window.__findDaycarePins!;
        const pins = probe.rendered();
        const base = pins.filter((p) => p.layer.startsWith('facility-pins-'));
        const isolated = base.filter((p) => p.key === facilityId);
        return isolated.map((p) => {
          const centre = (horizontal: boolean) => {
            const hits: number[] = [];
            for (let d = -24; d <= 24; d += 0.125) {
              if (probe.pick(p.clientX + (horizontal ? d : 0), p.clientY + (horizontal ? 0 : d)) === p.key) hits.push(d);
            }
            return (hits[0] + hits[hits.length - 1]) / 2;
          };
          return {
            id: p.key,
            x: p.clientX,
            y: p.clientY,
            vacancy: p.face.kind === 'facility' ? p.face.vacancy : 0,
            dx: centre(true),
            dy: centre(false),
          };
        });
      }, id);
      expect(samples.length).toBe(1);
      await testInfo.attach('drawn-and-hit-centres', { body: JSON.stringify(samples), contentType: 'application/json' });
      for (const pin of samples) expect(Math.hypot(pin.dx, pin.dy), pin.id).toBeLessThanOrEqual(0.5);
      const pin = samples[0];
      const color = await pixelAt(page, pin.x + 7, pin.y);
      expect(color.every((c, i) => Math.abs(c - (pin.vacancy > 0 ? [37, 123, 86] : [240, 240, 238])[i]) < 20)).toBe(true);
      await page.mouse.click(pin.x + 7, pin.y);
      await expect(page.locator('article[aria-current="true"]')).toHaveAttribute('data-facility-id', pin.id);
      await expectSelectedPinCount(page, 1);
    });
  }
}
