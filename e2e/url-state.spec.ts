import { viewToggle } from './map.ts';
import { expect, test, type Page } from '@playwright/test';
import data from '../src/data/facilities.json' with { type: 'json' };

const cards = (page: Page) => page.getByRole('article');
const selected = (page: Page) => page.locator('article[aria-current="true"]');
const ids = (page: Page) => cards(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-facility-id')));

test.beforeEach(async ({ context }) => {
  await context.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
});

for (const [device, viewport] of [
  ['desktop', { width: 1280, height: 800 }],
  ['mobile', { width: 390, height: 844 }],
] as const) {
  test(`${device}: 絞り込み・並び順・施設選択を新しいページと再読み込みで復元する`, async ({ page, context }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/?ward=kita,abeno&type=nursery,kigyo');
    await page.getByRole('region', { name: '絞り込み' }).getByRole('button', { name: '0歳', exact: true }).click();
    await page.getByRole('checkbox', { name: '空きがある施設のみ' }).check();
    await page.getByRole('combobox', { name: '並び順' }).selectOption('name');
    const count = data.facilities.filter(
      (f) => ['kita', 'abeno'].includes(f.ward) && ['nursery', 'kigyo'].includes(f.facilityType) && (f.vacancies[0] ?? 0) > 0,
    ).length;
    await expect(cards(page)).toHaveCount(count);
    const card = cards(page).nth(1);
    const id = await card.getAttribute('data-facility-id');
    await card.getByRole('heading').click();
    await expect.poll(() => new URL(page.url()).searchParams.get('facility')).toBe(id);
    const url = new URL(page.url());
    expect(Object.fromEntries(url.searchParams)).toEqual({
      ward: 'kita,abeno',
      type: 'nursery,kigyo',
      age: '0',
      open: '1',
      sort: 'name',
      facility: id,
    });
    const before = await ids(page);
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    const fresh = await context.newPage();
    await fresh.setViewportSize(viewport);
    await fresh.goto(page.url());
    for (const restored of [fresh, page]) {
      if (restored === page) await page.reload();
      await expect(cards(restored)).toHaveCount(count);
      expect(await ids(restored)).toEqual(before);
      await expect(
        restored.getByRole('region', { name: '絞り込み' }).getByRole('button', { name: '0歳', exact: true }),
      ).toHaveAttribute('aria-pressed', 'true');
      for (const ward of data.wards)
        await expect(
          restored.getByRole('group', { name: '区', exact: true }).getByRole('button', { name: ward.name, exact: true }),
        ).toHaveAttribute('aria-pressed', String(['kita', 'abeno'].includes(ward.id)));
      for (const [name, pressed] of [
        ['保育所', true],
        ['認定こども園', false],
        ['地域型保育（0〜2歳）', false],
        ['企業主導型', true],
      ] as const)
        await expect(
          restored.getByRole('region', { name: '絞り込み' }).getByRole('button', { name, exact: true }),
        ).toHaveAttribute('aria-pressed', String(pressed));
      await expect(restored.getByRole('checkbox', { name: '空きがある施設のみ' })).toBeChecked();
      await expect(restored.getByRole('combobox', { name: '並び順' })).toHaveValue('name');
      await expect(selected(restored)).toHaveAttribute('data-facility-id', id!);
      await expect(selected(restored)).toBeInViewport({ ratio: 0.99 });
    }
    await testInfo.attach('共有 URL', { body: page.url(), contentType: 'text/plain' });
    await fresh.close();
  });

  test(`${device}: URL の画面外の施設へ移動する`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(cards(page)).toHaveCount(data.facilities.length);
    const target = cards(page).last();
    await expect(target).not.toBeInViewport();
    const id = await target.getAttribute('data-facility-id');
    const facility = data.facilities.find((f) => f.id === id)!;
    expect(facility).toBeDefined();
    await page.goto(`/?facility=${facility.id}`);
    await expect(selected(page)).toHaveAttribute('data-facility-id', facility.id);
    await expect(selected(page)).toBeInViewport({ ratio: 0.99 });
    if (device === 'mobile') await viewToggle(page).getByRole('button', { name: '地図', exact: true }).click();
    await expect(page.locator('.pin--selected')).toBeInViewport();
    await expect(page.getByRole('group', { name: '施設の詳細' })).toContainText(facility.name);
    expect(new URL(page.url()).searchParams.size).toBe(1);
  });
}

test('既定に戻すと URL が / になり、操作で履歴が増えない', async ({ page }) => {
  await page.goto('/');
  await expect(cards(page)).toHaveCount(data.facilities.length);
  const history = await page.evaluate(() => window.history.length);
  for (const name of ['1歳', '0歳'])
    await page.getByRole('region', { name: '絞り込み' }).getByRole('button', { name, exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('age')).toBe('0,1');
  await expect(page.getByText(/件中.*に空きあり/)).toContainText('（0歳・1歳クラス）');
  const ward = page.getByRole('group', { name: '区', exact: true }).getByRole('button').first();
  const type = page.getByRole('region', { name: '絞り込み' }).getByRole('button', { name: '保育所', exact: true });
  await ward.click();
  await type.click();
  await page.getByRole('checkbox', { name: '空きがある施設のみ' }).check();
  await page.getByRole('combobox', { name: '並び順' }).selectOption('name');
  await expect.poll(() => new URL(page.url()).searchParams.get('sort')).toBe('name');
  await ward.click();
  await type.click();
  for (const name of ['0歳', '1歳'])
    await page.getByRole('region', { name: '絞り込み' }).getByRole('button', { name, exact: true }).click();
  await page.getByRole('checkbox', { name: '空きがある施設のみ' }).uncheck();
  await page.getByRole('combobox', { name: '並び順' }).selectOption('vacancy');
  await expect(page).toHaveURL('/');
  expect(await page.evaluate(() => window.history.length)).toBe(history);
});

test('不正な値を無視し、自宅なしの距離順を空きが多い順にする', async ({ page }) => {
  await page.goto('/');
  await expect(cards(page)).toHaveCount(data.facilities.length);
  const defaults = await ids(page);
  await page.goto('/?ward=unknown&age=-1,6,01&type=unknown&open=true&sort=unknown&facility=unknown');
  await expect(cards(page)).toHaveCount(data.facilities.length);
  expect(await ids(page)).toEqual(defaults);
  await expect(selected(page)).toHaveCount(0);
  await expect(page.getByRole('region', { name: '絞り込み' }).getByRole('button', { name: '0歳', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.getByRole('checkbox', { name: '空きがある施設のみ' })).not.toBeChecked();
  await expect(page.getByRole('combobox', { name: '並び順' })).toHaveValue('vacancy');
  await page.goto('/?sort=distance');
  await expect(cards(page)).toHaveCount(data.facilities.length);
  expect(await ids(page)).toEqual(defaults);
  await expect(page.getByRole('combobox', { name: '並び順' })).toHaveValue('vacancy');
});

test('空の区・施設種別と混在する不正値を復元できる', async ({ page }) => {
  await page.goto('/?ward=&type=');
  await expect(cards(page)).toHaveCount(0);
  await expect(page.getByText('条件に合う施設がありません。絞り込みを変更してください。')).toBeVisible();
  await page.goto('/?ward=unknown,kita&age=6,0,0&type=other,nursery');
  await expect(cards(page)).toHaveCount(
    data.facilities.filter((f) => f.ward === 'kita' && f.facilityType === 'nursery' && f.vacancies[0] !== null).length,
  );
  await expect(page.getByRole('region', { name: '絞り込み' }).getByRole('button', { name: '0歳', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('住所入力と自宅は URL に含めず、localStorage にだけ残す', async ({ page, context }) => {
  const address = '大阪市北区中之島1-3-20';
  await context.route('https://msearch.gsi.go.jp/**', (route) =>
    route.fulfill({ json: [{ geometry: { coordinates: [135.5023, 34.6937] }, properties: { title: address } }] }),
  );
  await page.goto('/');
  await page.getByRole('searchbox', { name: '自宅の住所' }).fill(address);
  await expect(page).toHaveURL('/');
  await page.getByRole('banner').getByRole('button', { name: '近い順に並べる' }).click();
  await expect(page.getByRole('status')).toHaveText([new RegExp(address)]);
  await expect(page.getByRole('combobox', { name: '並び順' })).toHaveValue('distance');
  await expect(page).toHaveURL('/');
  const home = await page.evaluate(() => JSON.parse(localStorage.getItem('find-daycare:home')!));
  expect(home).toEqual({ lat: 34.6937, lng: 135.5023, label: address });
  await page.getByRole('region', { name: '絞り込み' }).getByRole('button', { name: '0歳', exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('age')).toBe('0');
  expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({ age: '0' });
  await page.reload();
  await expect(page.getByRole('status')).toHaveText([new RegExp(address)]);
  await expect(page.getByRole('combobox', { name: '並び順' })).toHaveValue('distance');
  await page.getByRole('combobox', { name: '並び順' }).selectOption('vacancy');
  await expect.poll(() => new URL(page.url()).searchParams.get('sort')).toBe('vacancy');
  await page.reload();
  await expect(page.getByRole('combobox', { name: '並び順' })).toHaveValue('vacancy');
});

for (const ward of ['', ',']) {
  test('空トークンだけの区は選択0件: ' + JSON.stringify(ward), async ({ page }) => {
    await page.goto('/?ward=' + ward);
    await expect(cards(page)).toHaveCount(0);
    for (const button of await page.getByRole('group', { name: '区', exact: true }).getByRole('button').all())
      await expect(button).toHaveAttribute('aria-pressed', 'false');
  });
}

test('初期絞り込みで隠れた施設は URL から消え、条件を広げても選択されない', async ({ page }) => {
  const facility = data.facilities.find((f) => f.ward === 'kita')!;
  await page.goto('/?ward=abeno&facility=' + facility.id);
  await expect(cards(page)).toHaveCount(data.facilities.filter((f) => f.ward === 'abeno').length);
  await expect.poll(() => new URL(page.url()).searchParams.has('facility')).toBe(false);
  await expect(selected(page)).toHaveCount(0);
  await expect(page.locator('.pin--selected')).toHaveCount(0);
  await page.getByRole('group', { name: '区', exact: true }).getByRole('button', { name: '北区', exact: true }).click();
  await expect(page.locator('article[data-facility-id="' + facility.id + '"]')).toHaveCount(1);
  await expect(selected(page)).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('facility')).toBe(false);
});

test('自宅の解除で既定の距離順が空きが多い順へ戻る', async ({ page }) => {
  await page.goto('/');
  await expect(cards(page)).toHaveCount(data.facilities.length);
  const vacancyOrder = await ids(page);
  await page.evaluate(() =>
    localStorage.setItem('find-daycare:home', JSON.stringify({ lat: 34.6937, lng: 135.5023, label: '自宅' })),
  );
  await page.reload();
  await expect(page.getByRole('combobox', { name: '並び順' })).toHaveValue('distance');
  expect(await ids(page)).not.toEqual(vacancyOrder);
  await page.getByRole('banner').getByRole('button', { name: '解除', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '並び順' })).toHaveValue('vacancy');
  expect(await ids(page)).toEqual(vacancyOrder);
  await expect(page).toHaveURL('/');
});

test('自宅を解除したあとも明示した空きが多い順の URL は保持する', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('find-daycare:home', JSON.stringify({ lat: 34.6937, lng: 135.5023, label: '自宅' })),
  );
  await page.goto('/?sort=vacancy');
  await expect(page.getByRole('banner').getByRole('button', { name: '解除', exact: true })).toBeVisible();
  await page.getByRole('banner').getByRole('button', { name: '解除', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '並び順' })).toHaveValue('vacancy');
  await expect(page).toHaveURL('/?sort=vacancy');
});

test('mobile: カードの選択で一覧と画面をスクロールしない', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const card = cards(page).nth(4);
  const heading = card.getByRole('heading');
  await card.evaluate((node) => window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY - window.innerHeight + 100));
  await expect(heading).toBeInViewport();
  expect((await card.boundingBox())!.y + (await card.boundingBox())!.height).toBeGreaterThan(844);
  const position = () =>
    page.evaluate(() => ({ window: window.scrollY, list: document.querySelector('[aria-label="施設一覧"]')!.scrollTop }));
  const before = await position();
  expect(before.window).toBeGreaterThan(0);
  const id = await card.getAttribute('data-facility-id');
  await heading.click();
  await expect(selected(page)).toHaveAttribute('data-facility-id', id!);
  await expect.poll(() => new URL(page.url()).searchParams.get('facility')).toBe(id);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await position()).toEqual(before);
});

test('初期地図は URL の絞り込みや0件にかかわらず全施設の範囲を保つ', async ({ page }) => {
  await page.goto('/');
  await expect(cards(page)).toHaveCount(data.facilities.length);
  const abeno = data.facilities.find((f) => f.ward === 'abeno')!;
  const kita = data.facilities.find((f) => f.ward === 'kita')!;
  const transform = async (name: string) =>
    page.locator('.maplibregl-marker').evaluateAll(
      (nodes, facilityName) =>
        nodes
          .find((node) =>
            node
              .querySelector('.pin')
              ?.getAttribute('aria-label')
              ?.startsWith(facilityName + '（'),
          )
          ?.getAttribute('style') ?? null,
      name,
    );
  const expectedAbeno = await transform(abeno.name);
  const expectedKita = await transform(kita.name);
  expect(expectedAbeno).toContain('translate');
  for (const query of ['?ward=abeno', '?ward=']) {
    await page.goto('/' + query);
    await expect(page.getByRole('group', { name: '区', exact: true })).toBeVisible();
    if (query === '?ward=')
      await page.getByRole('group', { name: '区', exact: true }).getByRole('button', { name: '阿倍野区', exact: true }).click();
    await expect.poll(() => transform(abeno.name)).toBe(expectedAbeno);
    await page.getByRole('group', { name: '区', exact: true }).getByRole('button', { name: '北区', exact: true }).click();
    await expect.poll(() => transform(kita.name)).toBe(expectedKita);
  }
});

for (const onlyOpen of [false, true]) {
  test('年齢で隠れた選択施設は条件を戻すと再表示され、URL に残る: 空きのみ=' + onlyOpen, async ({ page }) => {
    const facility = data.facilities.find((f) =>
      onlyOpen ? f.vacancies[0] === 0 && f.vacancies.some((count) => (count ?? 0) > 0) : f.vacancies[0] === null,
    )!;
    expect(facility).toBeDefined();
    await page.goto('/');
    if (onlyOpen) await page.getByRole('checkbox', { name: '空きがある施設のみ' }).check();
    const card = page.locator('article[data-facility-id="' + facility.id + '"]');
    await card.getByRole('heading').click();
    await expect(selected(page)).toHaveAttribute('data-facility-id', facility.id);
    await expect.poll(() => new URL(page.url()).searchParams.get('facility')).toBe(facility.id);
    await page.getByRole('region', { name: '絞り込み' }).getByRole('button', { name: '0歳', exact: true }).click();
    await expect(card).toHaveCount(0);
    await expect(selected(page)).toHaveCount(0);
    await expect(page.locator('.pin--selected')).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.get('age')).toBe('0');
    expect(new URL(page.url()).searchParams.get('facility')).toBe(facility.id);
    await page.getByRole('region', { name: '絞り込み' }).getByRole('button', { name: '0歳', exact: true }).click();
    await expect(selected(page)).toHaveAttribute('data-facility-id', facility.id);
    await expect(page.locator('.pin--selected')).toHaveCount(1);
    await expect.poll(() => new URL(page.url()).searchParams.has('age')).toBe(false);
    expect(new URL(page.url()).searchParams.get('facility')).toBe(facility.id);
  });
}
