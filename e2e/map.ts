import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';

export async function mapAxe(page: Page, selectors: string[] = []) {
  const scan = () => {
    const builder = new AxeBuilder({ page });
    for (const selector of selectors) builder.include(selector);
    return builder;
  };
  const hiddenMarkers = (await page.locator('.maplibregl-popup').isVisible())
    ? await page.evaluateHandle(() =>
        [...document.querySelectorAll<HTMLElement>('.maplibregl-marker')].map((element) => {
          const previous = {
            element,
            value: element.style.getPropertyValue('visibility'),
            priority: element.style.getPropertyPriority('visibility'),
          };
          // style要素の追加はCSPで拒否されるため、ピンの属性で背後の重なりだけを除く。
          element.style.setProperty('visibility', 'hidden', 'important');
          return previous;
        }),
      )
    : null;
  const general = await scan()
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .disableRules(['target-size'])
    .analyze();
  await hiddenMarkers?.evaluate((markers) =>
    markers.forEach(({ element, value, priority }) => element.style.setProperty('visibility', value, priority)),
  );
  await hiddenMarkers?.dispose();
  // SC 2.5.8 の Essential 例外は、位置が意味を持つ MapLibre ピンのサイズだけに適用する。
  const targets = await scan().withRules(['target-size']).exclude('.maplibregl-marker:has(.pin)').analyze();
  return [general, targets];
}

export async function mapContrastSummary(page: Page, results: Awaited<ReturnType<typeof mapAxe>>) {
  const summary = results.flatMap((result) =>
    result.incomplete
      .filter((rule) => rule.id === 'color-contrast')
      .flatMap((rule) => rule.nodes.map((node) => ({ target: node.target, reason: node.failureSummary }))),
  );
  return page.evaluate((nodes) => {
    return nodes.filter(
      (node) =>
        !node.target.some(
          (selector) => typeof selector === 'string' && document.querySelector(selector)?.closest('.maplibregl-marker'),
        ),
    );
  }, summary);
}

export async function expectUnlicensedPinShape(map: Locator) {
  const pins = map.getByRole('button', { name: /（認可外）/ }).getByRole('img');
  const styles = await pins.evaluateAll((nodes) =>
    nodes.map((node) => {
      const style = getComputedStyle(node);
      return { radius: style.borderRadius, border: style.borderColor, width: style.width, height: style.height };
    }),
  );
  expect(styles.length, '認可外のピンがある').toBeGreaterThan(0);
  for (const style of styles) {
    expect(style).toEqual({ radius: '7px', border: 'rgb(138, 90, 18)', width: '30px', height: '30px' });
  }
}

export async function expectLicensedPinShape(map: Locator) {
  const pins = map.getByRole('button', { name: /（認可）/ }).getByRole('img');
  const styles = await pins.evaluateAll((nodes) =>
    nodes.map((node) => {
      const style = getComputedStyle(node);
      return { radius: style.borderRadius, border: style.borderColor };
    }),
  );
  expect(styles.length, '認可のピンがある').toBeGreaterThan(0);
  for (const style of styles) {
    expect(style.radius, '認可のピンは丸い').toBe('50%');
    expect(style.border, '認可のピンの縁は認可外の茶色ではない').not.toBe('rgb(138, 90, 18)');
  }
}

export async function openVisibleUnlicensedPopup(map: Locator) {
  const pins = map.getByRole('button', { name: /（認可外）/ });
  const index = await pins.evaluateAll((nodes) =>
    nodes.findIndex((node) => {
      const box = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    }),
  );
  expect(index, '地図内に操作できる認可外ピンがある').toBeGreaterThanOrEqual(0);
  await pins.nth(index).click();
  await expect(map.locator('.maplibregl-popup')).toHaveCSS('opacity', '1');
}
