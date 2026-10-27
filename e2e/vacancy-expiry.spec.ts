import { expect, test, type Page } from '@playwright/test';
import data from '../src/data/facilities.json' with { type: 'json' };
import { leafletAxe, leafletContrastSummary } from './leaflet.ts';

const badge = '入所日を過ぎた空き情報';
const warning = (page: Page) => page.getByRole('note', { name: '入所日を過ぎた空き情報' });
const card = (page: Page, id: string) => page.locator('article[data-facility-id="' + id + '"]');
const licensed = data.facilities.find((facility) => facility.ward === 'kita' && facility.facilityType === 'nursery')!;
const corporate = data.facilities.find((facility) => facility.ward === 'kita' && facility.facilityType === 'kigyo')!;

async function expectAccessible(
  page: Page,
  selectors: string[] = ['header:has(h1)', 'article[data-facility-id="' + licensed.id + '"]'],
) {
  const results = await leafletAxe(page, selectors);
  expect(results.flatMap((result) => result.violations)).toEqual([]);
  expect(await leafletContrastSummary(page, results)).toEqual([]);
}

async function showPopup(page: Page, mobile: boolean) {
  if (mobile) await page.getByRole('button', { name: '地図', exact: true }).click();
  const popup = page.getByRole('group', { name: '施設の詳細' });
  await expect(popup).toBeVisible();
  await page.getByRole('region', { name: '地図', exact: true }).scrollIntoViewIfNeeded();
  // Leaflet の flyTo は Date.now を使うため、停止した時計でも地図移動を完了させる。
  await page.clock.runFor(1_000);
  await page.locator('.leaflet-marker-icon:has(.pin--selected)').click();
  await page.clock.runFor(300);
  await expect(page.locator('.leaflet-popup')).toHaveCount(0);
  await page.locator('.leaflet-marker-icon:has(.pin--selected)').click();
  await page.clock.runFor(1_000);
  await expect(popup).toBeVisible();
  await expect(page.locator('.leaflet-popup')).toHaveCSS('opacity', '1');
  await expect(page.locator('.leaflet-popup')).toBeInViewport({ ratio: 1 });
  return popup;
}

function vacancyFixture(dates: Record<string, string> = {}, fallback = '2026-11-01', snapshot = '2026-10-27') {
  const fixture = structuredClone(data);
  for (const ward of fixture.wards) {
    ward.snapshot = snapshot;
    ward.admissionDate = dates[ward.id] ?? fallback;
    ward.vacancyFor = Number(ward.admissionDate.slice(5, 7)) + '月1日入所用';
    ward.vacancyAsOf = '令和8年10月1日現在';
  }
  return fixture;
}

async function installClock(page: Page, time: string) {
  await page.clock.install({ time: new Date(time) });
}

async function expectLoaded(page: Page) {
  await expect(page.getByRole('article')).toHaveCount(data.facilities.length);
  await expect(card(page, licensed.id).getByRole('table', { name: '年齢別の空き人数' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  test.setTimeout(60_000);
  await page.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
  await page.route('**/assets/facilities-*.json', (route) => route.fulfill({ json: vacancyFixture() }));
});

for (const [device, viewport, mobile] of [
  ['desktop', { width: 1280, height: 800 }, false],
  ['mobile', { width: 390, height: 844 }, true],
] as const) {
  test(device + ': 日本時間10月31日23時59分には警告も印もない', async ({ page }) => {
    await page.setViewportSize(viewport);
    await installClock(page, '2026-10-31T23:59:00+09:00');
    await page.clock.pauseAt(new Date('2026-10-31T23:59:00+09:00'));
    await page.goto('/?facility=' + licensed.id);
    await expectLoaded(page);
    expect(await page.evaluate(() => Date.now())).toBe(Date.parse('2026-10-31T23:59:00+09:00'));
    await expect(warning(page)).toHaveCount(0);
    await expect(page.getByRole('article').getByText(badge, { exact: true })).toHaveCount(0);
    const popup = await showPopup(page, mobile);
    await expect(popup).toContainText(licensed.name);
    await expect(popup.getByText(badge, { exact: true })).toHaveCount(0);
  });

  test(device + ': 日本時間11月1日0時から全区の警告と認可施設の印を表示する', async ({ page }) => {
    await page.setViewportSize(viewport);
    await installClock(page, '2026-11-01T00:00:00+09:00');
    await page.goto('/?facility=' + licensed.id);
    await expectLoaded(page);
    await expect(warning(page)).toHaveText(
      '空き情報（企業主導型を除く）は11月1日入所用のもので、入所日を過ぎています。最新の空き状況は各区役所に確認してください。',
    );
    expect(await warning(page).getAttribute('aria-live')).toBeNull();
    await expect(page.getByRole('article').getByText(badge, { exact: true })).toHaveCount(
      data.facilities.filter((facility) => facility.facilityType !== 'kigyo').length,
    );
    await expect(card(page, licensed.id).getByText(badge, { exact: true })).toBeVisible();
    await expect(card(page, corporate.id).getByText(badge, { exact: true })).toHaveCount(0);
    await expectAccessible(page);
    const popup = await showPopup(page, mobile);
    await expect(popup).toContainText(licensed.name);
    await expect(popup.getByText(badge, { exact: true })).toBeVisible();
    await expectAccessible(page, ['.leaflet-popup']);
    await page.goto('/?facility=' + corporate.id);
    const corporatePopup = await showPopup(page, mobile);
    await expect(corporatePopup).toContainText(corporate.name);
    await expect(corporatePopup.getByText(badge, { exact: true })).toHaveCount(0);
  });

  test(device + ': 一部だけ期限切れならその区名と該当施設だけに印を表示する', async ({ page }) => {
    await page.setViewportSize(viewport);
    await installClock(page, '2026-11-01T00:00:00+09:00');
    const expiredIds = new Set(['kita', 'abeno']);
    const mixed = vacancyFixture({ kita: '2026-11-01', abeno: '2026-11-01' }, '2026-12-01');
    await page.route('**/assets/facilities-*.json', (route) => route.fulfill({ json: mixed }));
    await page.goto('/?facility=' + licensed.id);
    await expectLoaded(page);
    const names = mixed.wards
      .filter((ward) => expiredIds.has(ward.id))
      .map((ward) => ward.name)
      .join('・');
    await expect(warning(page)).toHaveText(
      names +
        'の空き情報（企業主導型を除く）は11月1日入所用のもので、入所日を過ぎています。最新の空き状況は各区役所に確認してください。',
    );
    await expect(page.getByRole('article').getByText(badge, { exact: true })).toHaveCount(
      data.facilities.filter((facility) => expiredIds.has(facility.ward) && facility.facilityType !== 'kigyo').length,
    );
    const fresh = data.facilities.find((facility) => !expiredIds.has(facility.ward) && facility.facilityType === 'nursery')!;
    await expect(card(page, fresh.id).getByText(badge, { exact: true })).toHaveCount(0);
    await expect(card(page, corporate.id).getByText(badge, { exact: true })).toHaveCount(0);
    await expectAccessible(page);
    const popup = await showPopup(page, mobile);
    await expect(popup.getByText(badge, { exact: true })).toBeVisible();
    await expectAccessible(page, ['.leaflet-popup']);
    await page.goto('/?facility=' + fresh.id);
    const freshPopup = await showPopup(page, mobile);
    await expect(freshPopup).toContainText(fresh.name);
    await expect(freshPopup.getByText(badge, { exact: true })).toHaveCount(0);
  });
  test(device + ': 入所月が違う区は対応する月ごとに警告する', async ({ page }) => {
    await page.setViewportSize(viewport);
    await installClock(page, '2026-12-01T00:00:00+09:00');
    const mixed = vacancyFixture({ kita: '2026-11-01', abeno: '2026-12-01' }, '2027-01-01', '2026-11-27');
    await page.route('**/assets/facilities-*.json', (route) => route.fulfill({ json: mixed }));
    await page.goto('/?facility=' + licensed.id);
    await expectLoaded(page);
    const grouped = mixed.wards
      .filter((ward) => ['kita', 'abeno'].includes(ward.id))
      .map((ward) => ward.name + 'は' + ward.vacancyFor)
      .join('、');
    await expect(warning(page)).toHaveText(
      grouped + 'の空き情報（企業主導型を除く）で、入所日を過ぎています。最新の空き状況は各区役所に確認してください。',
    );
    await expect(card(page, licensed.id).getByText(badge, { exact: true })).toBeVisible();
    await expectAccessible(page);
    const popup = await showPopup(page, mobile);
    await expect(popup.getByText(badge, { exact: true })).toBeVisible();
    await expectAccessible(page, ['.leaflet-popup']);
  });
}

test('開いたまま日本時間の入所月を迎えると警告と印が切り替わる', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-31T23:59:00+09:00') });
  await page.clock.pauseAt(new Date('2026-10-31T23:59:00+09:00'));
  await page.goto('/');
  await expectLoaded(page);
  await expect(warning(page)).toHaveCount(0);
  await page.clock.runFor(59_999);
  expect(await page.evaluate(() => Date.now())).toBe(Date.parse('2026-10-31T23:59:59.999+09:00'));
  await expectLoaded(page);
  await expect(warning(page)).toHaveCount(0);
  await expect(card(page, licensed.id).getByText(badge, { exact: true })).toHaveCount(0);
  await page.clock.runFor(1);
  await expect(warning(page)).toBeVisible();
  await expect(card(page, licensed.id).getByText(badge, { exact: true })).toHaveCount(1);
  await expect(card(page, corporate.id).getByText(badge, { exact: true })).toHaveCount(0);
});

test('入所日まで25日以上ある画面でも月初まで警告を出さない', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-01T00:00:00+09:00') });
  await page.clock.pauseAt(new Date('2026-10-01T00:00:00+09:00'));
  await page.goto('/');
  await expectLoaded(page);
  await page.clock.fastForward(20 * 24 * 60 * 60 * 1000);
  await page.clock.fastForward(10 * 24 * 60 * 60 * 1000);
  expect(await page.evaluate(() => Date.now())).toBe(Date.parse('2026-10-31T00:00:00+09:00'));
  await expectLoaded(page);
  await expect(warning(page)).toHaveCount(0);
  await page.clock.fastForward(24 * 60 * 60 * 1000);
  await expect(warning(page)).toBeVisible();
});

for (const event of ['visibilitychange', 'pageshow', 'focus'] as const) {
  test(event + 'で復帰しても期限切れの区が変わらなければマーカーとカードのDOMを保つ', async ({ page }) => {
    const before = new Date('2026-10-31T23:59:00+09:00');
    await page.clock.install({ time: before });
    await page.clock.pauseAt(before);
    await page.goto('/');
    await expectLoaded(page);
    await expect(page.locator('.leaflet-marker-icon .pin')).toHaveCount(data.facilities.length);
    const elements = await page.evaluateHandle(() => ({
      markers: [...document.querySelectorAll('.leaflet-marker-icon .pin')],
      cards: [...document.querySelectorAll('article, article *')],
    }));
    try {
      await page.evaluate((eventName) => {
        if (eventName === 'visibilitychange') {
          Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
          document.dispatchEvent(new Event(eventName));
          Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
          document.dispatchEvent(new Event(eventName));
        } else window.dispatchEvent(new Event(eventName));
      }, event);
      await page.clock.runFor(100);
      await expectLoaded(page);
      expect(
        await page.evaluate((previous) => {
          const sameElements = (selector: string, originalElements: Element[]) => {
            const after = [...document.querySelectorAll(selector)];
            return (
              after.length === originalElements.length && after.every((element, index) => element === originalElements[index])
            );
          };
          return {
            markers: sameElements('.leaflet-marker-icon .pin', previous.markers),
            cards: sameElements('article, article *', previous.cards),
          };
        }, elements),
      ).toEqual({ markers: true, cards: true });
      await expect(warning(page)).toHaveCount(0);
    } finally {
      await elements.dispose();
    }
    await page.clock.runFor(59_900);
    await expect(warning(page)).toBeVisible();
    await expect(card(page, licensed.id).getByText(badge, { exact: true })).toBeVisible();
  });

  test(event + 'で復帰すると停止していたタイマーを待たず期限を取り直す', async ({ page }) => {
    const before = new Date('2026-10-31T23:59:00+09:00');
    await page.clock.install({ time: before });
    await page.clock.pauseAt(before);
    await page.goto('/');
    await expectLoaded(page);
    await expect(warning(page)).toHaveCount(0);
    await page.clock.setSystemTime(new Date('2026-11-01T00:00:00+09:00'));
    expect(await page.evaluate(() => Date.now())).toBe(Date.parse('2026-11-01T00:00:00+09:00'));
    if (event === 'visibilitychange') {
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await expectLoaded(page);
      await expect(warning(page)).toHaveCount(0);
    }
    await page.evaluate((eventName) => {
      if (eventName === 'visibilitychange') {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
        document.dispatchEvent(new Event(eventName));
      } else window.dispatchEvent(new Event(eventName));
    }, event);
    await expect(warning(page)).toBeVisible();
    await expect(card(page, licensed.id).getByText(badge, { exact: true })).toBeVisible();
  });
}
