import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';

export async function mapAxe(page: Page, selectors: string[] = []) {
  const scan = () => {
    const builder = new AxeBuilder({ page });
    for (const selector of selectors) builder.include(selector);
    return builder;
  };
  const general = await scan()
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .disableRules(['target-size'])
    .analyze();
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
    const popupContrastIsKnown = (node: Element | null) => {
      if (!(node instanceof HTMLElement) || !node.closest('.maplibregl-popup')) return false;
      const style = getComputedStyle(node);
      const rgb = (color: string) => (/^rgba?\(/.test(color) ? color.match(/[\d.]+/g)?.map(Number) : undefined);
      const foreground = rgb(style.color);
      const background = rgb(style.backgroundColor);
      if (!foreground || !background || (foreground[3] ?? 1) !== 1 || (background[3] ?? 1) !== 1 || style.textShadow !== 'none')
        return false;
      for (let ancestor: Element | null = node; ancestor; ancestor = ancestor.parentElement) {
        const computed = getComputedStyle(ancestor);
        if (computed.opacity !== '1' || computed.filter !== 'none' || computed.mixBlendMode !== 'normal') return false;
      }
      const range = document.createRange();
      range.selectNodeContents(node);
      const rectangles = [...range.getClientRects()];
      if (
        !rectangles.length ||
        rectangles.some((rect) => !node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)))
      )
        return false;
      const luminance = (color: number[]) =>
        color
          .slice(0, 3)
          .map((channel) => {
            const value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          })
          .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      const light = luminance(foreground);
      const dark = luminance(background);
      const ratio = (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
      const size = parseFloat(style.fontSize);
      const threshold = size >= 24 || (size >= 18.6667 && Number(style.fontWeight) >= 700) ? 3 : 4.5;
      return ratio >= threshold;
    };
    // axe は不透明なセルの背後にあるピンも比較するため、前面の色と文字の可視性を直接確かめる。
    return nodes.filter(
      (node) =>
        !node.target.some(
          (selector) =>
            typeof selector === 'string' &&
            (document.querySelector(selector)?.closest('.maplibregl-marker') ||
              popupContrastIsKnown(document.querySelector(selector))),
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
