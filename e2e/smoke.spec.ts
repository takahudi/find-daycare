import { expect, test, type Page } from '@playwright/test';
import {
  openVisibleUnlicensedPopup,
  expectUnlicensedPinShape,
  expectLicensedPinShape,
  leafletAxe,
  leafletContrastSummary,
} from './leaflet.ts';
import data from '../src/data/facilities.json' with { type: 'json' };

function parseCsp(header: string) {
  const directives = new Map<string, Set<string>>();
  for (const directive of header.split(';').filter((value) => value.trim())) {
    const [name, ...sources] = directive.trim().split(/\s+/);
    const normalizedName = name.toLowerCase();
    expect(directives.has(normalizedName), `CSP directive の重複: ${normalizedName}`).toBe(false);
    directives.set(normalizedName, new Set(sources));
  }
  return directives;
}

const expectedCsp = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'connect-src': ["'self'", 'https://msearch.gsi.go.jp'],
  'img-src': ["'self'", 'data:', 'https://cyberjapandata.gsi.go.jp'],
  'font-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
};

const violationsByPage = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const violations: string[] = [];
  violationsByPage.set(page, violations);
  page.on('console', (message) => {
    if (message.text().startsWith('CSP violation:')) violations.push(message.text());
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.error(`CSP violation: ${event.effectiveDirective} ${event.blockedURI}`);
    });
  });
  // 地図タイルと住所検索は外部サービスなので、テストの結果をそれらの応答に左右させない
  await page.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
  await page.goto('/');
});

test('トップページを開ける', async ({ page }) => {
  await expect(page).toHaveTitle('大阪市 保育施設 空き状況マップ');
  await expect(page.getByText('空き情報：', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('空き状況マップ');
});

test('施設のカードが表示される', async ({ page }) => {
  const cards = page.getByRole('region', { name: '施設一覧' }).getByRole('article');
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThan(0);
});

test('クラス年齢を選ぶと、その年齢を受け入れる施設と空きのある施設の件数に絞られる', async ({ page }) => {
  const { facilities } = data;
  const hasOpening = (f: { vacancies: (number | null)[] }, ages: number[]) => ages.some((a) => (f.vacancies[a] ?? 0) > 0);
  const acceptingZero = facilities.filter((f) => f.vacancies[0] !== null);
  const summary = page.getByText(/件中.*に空きあり/);
  const chip = page.getByRole('button', { name: '0歳', exact: true });

  await expect(summary).toHaveText(
    `${facilities.length}件中 ${facilities.filter((f) => hasOpening(f, [0, 1, 2, 3, 4, 5])).length}件に空きあり`,
  );

  await chip.click();

  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(summary).toHaveText(
    `${acceptingZero.length}件中 ${acceptingZero.filter((f) => hasOpening(f, [0])).length}件に空きあり（0歳クラス）`,
  );
});

test('地図と施設のピンが表示される', async ({ page }) => {
  const map = page.getByRole('region', { name: '地図' });
  await expect(map).toBeVisible();
  await expect(map.getByRole('button', { name: /（認可(?:外)?）/ }).first()).toBeVisible();
});

test('住所を検索すると、その住所からの距離で施設を表示する', async ({ page }) => {
  const address = '大阪市北区中之島1-3-20';
  await page.route('https://msearch.gsi.go.jp/**', (route) =>
    route.fulfill({
      json: [{ geometry: { coordinates: [135.5023, 34.6937] }, properties: { title: address } }],
    }),
  );

  await page.getByRole('searchbox', { name: '自宅の住所' }).fill(address);
  await page.getByRole('button', { name: '近い順に並べる' }).click();

  await expect(page.getByRole('status')).toContainText(address);
  await expect(page.getByRole('status')).toContainText('からの直線距離で表示中');
  await expect(page.getByRole('region', { name: '施設一覧' }).getByRole('article').first()).toContainText('自宅から');
});

test.afterEach(async ({ page }) => {
  expect(violationsByPage.get(page), '読み込みと操作の間に CSP 違反がない').toEqual([]);
});

for (const path of ['/', '/?a=b']) {
  test(`${path} はセキュリティヘッダー付きでアプリを表示する`, async ({ page }) => {
    const response = await page.goto(path);

    expect(response?.status()).toBe(200);
    expect(response?.headers()).toMatchObject({
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'cross-origin-opener-policy': 'same-origin',
    });
    const csp = response?.headers()['content-security-policy'];
    expect(csp).toBeDefined();
    const directives = parseCsp(csp ?? '');
    expect(directives).toEqual(new Map(Object.entries(expectedCsp).map(([name, sources]) => [name, new Set(sources)])));
    const permissionsPolicy = response?.headers()['permissions-policy'];
    expect(permissionsPolicy).toBeDefined();
    expect(permissionsPolicy).toContain('geolocation=(self)');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('空き状況マップ');
    await expect(page.getByRole('region', { name: '施設一覧' }).getByRole('article').first()).toBeVisible();
  });
}

test('/wrangler.json は生成ファイルを公開せず404を返す', async ({ request }) => {
  const response = await request.get('/wrangler.json');

  expect(response.status()).toBe(404);
});

test('施設種別の選択肢を保ち、企業主導型と認可外を別のバッジで表示する', async ({ page }) => {
  const chips = page.getByRole('group', { name: '種別', exact: true }).getByRole('button');
  await expect(chips).toHaveText(['保育所', '認定こども園', '地域型保育（0〜2歳）', '企業主導型']);
  const cards = page.getByRole('region', { name: '施設一覧' }).getByRole('article');
  await expect(cards).toHaveCount(data.facilities.length);
  for (const [type, label, color] of [
    ['nursery', '保育所', 'rgb(51, 108, 188)'],
    ['kodomoen', '認定こども園', 'rgb(168, 74, 124)'],
    ['community', '地域型保育事業', 'rgb(118, 92, 179)'],
    ['kigyo', '企業主導型', 'rgb(151, 100, 26)'],
  ]) {
    const facility = representativeFacility(label, (f) => f.facilityType === type);
    await expect(
      facilityCard(page, facility)
        .getByRole('list', { name: '分類' })
        .getByRole('listitem')
        .filter({ hasText: new RegExp(`^${label}$`) }),
    ).toHaveCSS('background-color', color);
  }
  for (const label of ['保育所', '認定こども園', '地域型保育（0〜2歳）']) {
    await page.getByRole('button', { name: label, exact: true }).click();
  }
  const kigyoCount = data.facilities.filter((facility) => facility.facilityType === 'kigyo').length;
  await expect(cards).toHaveCount(kigyoCount);
  await expect(cards.first().getByRole('list', { name: '分類' }).getByRole('listitem')).toHaveText([
    /.+区/,
    '企業主導型',
    '認可外',
  ]);
  await expect(
    cards
      .first()
      .getByText('認可外保育施設です。申込みは区役所ではなく施設との直接契約です（空き人数は地域枠）。', { exact: true }),
  ).toBeVisible();
  await expectUnlicensedPinShape(page.getByRole('region', { name: '地図', exact: true }));
  await expect(page.getByRole('region', { name: '地図', exact: true }).getByRole('button', { name: /（認可外）/ })).toHaveCount(
    kigyoCount,
  );
  await expect(page.getByRole('group', { name: '地図の凡例' })).toContainText('認可外');
  await page.getByRole('button', { name: '企業主導型', exact: true }).click();
  await page.getByRole('button', { name: '保育所', exact: true }).click();
  await expect(cards).toHaveCount(data.facilities.filter((facility) => facility.facilityType === 'nursery').length);
  await expect(
    cards
      .first()
      .getByRole('list', { name: '分類' })
      .getByRole('listitem')
      .filter({ hasText: /^保育所$/ }),
  ).toHaveCount(1);
  await expect(
    cards
      .first()
      .getByRole('list', { name: '分類' })
      .getByRole('listitem')
      .filter({ hasText: /^認可外$/ }),
  ).toHaveCount(0);
  await expect(cards.first().getByText(/^認可外保育施設です。/)).toHaveCount(0);
  await expectLicensedPinShape(page.getByRole('region', { name: '地図', exact: true }));
  await expect(page.getByRole('region', { name: '地図', exact: true }).getByRole('button', { name: /（認可外）/ })).toHaveCount(
    0,
  );
});

test('モバイルの地図タブで企業主導型のポップアップに認可外と表示する', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const label of ['保育所', '認定こども園', '地域型保育（0〜2歳）']) {
    await page.getByRole('button', { name: label, exact: true }).click();
  }
  await page.getByRole('button', { name: '地図', exact: true }).click();
  const map = page.getByRole('region', { name: '地図' });
  await map.scrollIntoViewIfNeeded();
  await openVisibleUnlicensedPopup(map);
  await expect(page.getByRole('button', { name: '地図', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: '施設一覧' })).toBeHidden();
  await expect(map.getByRole('group', { name: '施設の詳細' })).toBeVisible();
  await expect(map.getByRole('group', { name: '施設の詳細' }).getByText(/.+区 ・ 企業主導型 ・ 認可外/)).toBeVisible();
});

type TestFacility = (typeof data.facilities)[number];

const facilityNameCounts = new Map<string, number>();
for (const facility of data.facilities) {
  facilityNameCounts.set(facility.name, (facilityNameCounts.get(facility.name) ?? 0) + 1);
}

function representativeFacility(state: string, predicate: (facility: TestFacility) => boolean) {
  const facility = data.facilities.find((f) => facilityNameCounts.get(f.name) === 1 && predicate(f));
  expect(facility, `全市のデータに「${state}」で、施設名が全市で一意の代表施設がありません`).toBeDefined();
  return facility!;
}

function facilityCard(page: Page, facility: TestFacility) {
  const name = facility.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.getByRole('article', { name: new RegExp(`^(?:\\d+\\s*)?${name}$`) });
}

function accessibilityRepresentatives() {
  const pick = (state: string, predicate: (facility: TestFacility) => boolean) =>
    representativeFacility(
      `${state}、0・1歳のいずれか受入れ可能`,
      (f) => (f.vacancies[0] !== null || f.vacancies[1] !== null) && predicate(f),
    );
  const shared = pick('共有枠', (f) => f.sharedVacancy !== null);
  const open = pick('共有枠以外の空きありセル', (f) =>
    f.vacancies.some((v, age) => v !== null && v > 0 && !f.sharedVacancy?.ages.includes(age)),
  );
  const ineligible = pick('受入れ対象外セル', (f) => f.vacancies.some((v) => v === null));
  const full = pick('空きなしセル', (f) => f.vacancies.some((v) => v === 0));
  const typeLabels: Record<string, string> = {
    nursery: '保育所',
    kodomoen: '認定こども園',
    community: '地域型保育事業',
    kigyo: '企業主導型',
  };
  const facilities = [
    ...new Set([
      ...Object.keys(typeLabels).map((type) => pick(`施設種別 ${type}`, (f) => f.facilityType === type)),
      ...['licensed', 'unlicensed'].map((licensing) => pick(`認可区分 ${licensing}`, (f) => f.licensing === licensing)),
      shared,
      open,
      ineligible,
      full,
      pick('所有区分・詳細種別のバッジ', (f) =>
        Boolean(f.ownership || (f.detailType && f.detailType !== typeLabels[f.facilityType])),
      ),
      pick('備考', (f) => Boolean(f.note)),
      pick('サービスのタグ', (f) => f.services.length > 0),
      pick('公式サイトへのリンク', (f) => Boolean(f.website)),
      pick('PDF へのリンク', (f) => Boolean(f.infoPdfUrl)),
    ]),
  ];
  return { shared, open, ineligible, full, facilities };
}

async function representativeScope(page: Page, facilities: TestFacility[]) {
  const selectors = [
    'header:has(h1)',
    '[aria-label="絞り込み"]',
    '[aria-label="表示切替"]',
    '[aria-label="施設一覧"] > p',
    '[aria-label="施設一覧"] > footer',
    '[aria-label="地図"]',
  ];
  for (const facility of facilities) {
    await expect(facilityCard(page, facility)).toHaveAttribute('data-facility-id', facility.id);
    selectors.push(`article[data-facility-id="${facility.id}"]`);
  }
  for (const selector of selectors) await expect(page.locator(selector)).toHaveCount(1);
  return selectors;
}

async function filterToRepresentativeWards(page: Page, facilities: TestFacility[]) {
  const wards = page.getByRole('group', { name: '区', exact: true });
  const selected = new Set(facilities.map((f) => f.ward));
  for (const ward of data.wards.filter((w) => !selected.has(w.id))) {
    await wards.getByRole('button', { name: ward.name, exact: true }).click();
  }
}

test('地図ピンの名前で空き人数と空きなしを区別できる', async ({ page }) => {
  const open = representativeFacility(
    '認可施設の空きありピン',
    (f) => f.licensing === 'licensed' && f.vacancies.some((v) => (v ?? 0) > 0),
  );
  const full = representativeFacility(
    '認可施設の空きなしピン',
    (f) => f.licensing === 'licensed' && f.vacancies.every((v) => (v ?? 0) === 0),
  );
  const count =
    open.vacancies.reduce<number>((sum, value, age) => sum + (open.sharedVacancy?.ages.includes(age) ? 0 : (value ?? 0)), 0) +
    (open.sharedVacancy?.count ?? 0);
  const map = page.getByRole('region', { name: '地図', exact: true });
  await expect(map.getByRole('button', { name: `${open.name}（認可）空き${count}人`, exact: true })).toHaveCount(1);
  await expect(map.getByRole('button', { name: `${full.name}（認可）空きなし`, exact: true })).toHaveCount(1);
});

type AccessibilityRepresentatives = ReturnType<typeof accessibilityRepresentatives>;

const representativeCardScope = (page: Page, reps: AccessibilityRepresentatives) => representativeScope(page, reps.facilities);

const accessibilityStates: {
  name: string;
  viewport: { width: number; height: number };
  fullPage: boolean;
  setup: (page: Page, reps: AccessibilityRepresentatives) => Promise<void>;
  scope: (page: Page, reps: AccessibilityRepresentatives) => Promise<string[]>;
}[] = [
  {
    name: 'デスクトップの初期表示',
    viewport: { width: 1280, height: 800 },
    fullPage: false,
    setup: async (page) => {
      await expect(page.getByRole('article')).toHaveCount(data.facilities.length);
    },
    scope: representativeCardScope,
  },
  {
    name: 'モバイルのリスト表示',
    viewport: { width: 390, height: 844 },
    fullPage: false,
    setup: async (page) => {
      await expect(page.getByRole('article')).toHaveCount(data.facilities.length);
      await expect(page.getByRole('button', { name: 'リスト', exact: true })).toHaveAttribute('aria-pressed', 'true');
    },
    scope: representativeCardScope,
  },
  {
    name: 'モバイルの地図で施設の詳細を表示',
    viewport: { width: 390, height: 844 },
    fullPage: true,
    setup: async (page) => {
      for (const label of ['保育所', '認定こども園', '地域型保育（0〜2歳）']) {
        await page.getByRole('group', { name: '種別', exact: true }).getByRole('button', { name: label, exact: true }).click();
      }
      await page.getByRole('button', { name: '地図', exact: true }).click();
      const map = page.getByRole('region', { name: '地図', exact: true });
      await map.scrollIntoViewIfNeeded();
      await openVisibleUnlicensedPopup(map);
      await expect(map.getByRole('group', { name: '施設の詳細' })).toBeVisible();
    },
    scope: async () => [],
  },
  {
    name: '住所検索で自宅を指定した表示',
    viewport: { width: 1280, height: 800 },
    fullPage: false,
    setup: async (page, { facilities }) => {
      await filterToRepresentativeWards(page, facilities);
      const address = '大阪市北区中之島1-3-20';
      await page.route('https://msearch.gsi.go.jp/**', (route) =>
        route.fulfill({ json: [{ geometry: { coordinates: [135.5023, 34.6937] }, properties: { title: address } }] }),
      );
      await page.getByRole('searchbox', { name: '自宅の住所' }).fill(address);
      await page.getByRole('button', { name: '近い順に並べる' }).click();
      await expect(page.getByRole('status')).toContainText(address);
      await expect(page.getByRole('article').first()).toContainText('自宅から');
    },
    scope: representativeCardScope,
  },
  {
    name: '全施設種別と空き人数の各状態を含む絞り込みとカード選択',
    viewport: { width: 390, height: 844 },
    fullPage: false,
    setup: async (page, { facilities, shared, open, ineligible, full }) => {
      await filterToRepresentativeWards(page, facilities);
      const ages = page.getByRole('group', { name: 'クラス年齢', exact: true });
      await ages.getByRole('button', { name: '0歳', exact: true }).click();
      await ages.getByRole('button', { name: '1歳', exact: true }).click();
      const wardIds = new Set(facilities.map((f) => f.ward));
      await expect(page.getByRole('article')).toHaveCount(
        data.facilities.filter((f) => wardIds.has(f.ward) && (f.vacancies[0] !== null || f.vacancies[1] !== null)).length,
      );
      for (const facility of facilities) await expect(facilityCard(page, facility)).toBeVisible();
      await expect(facilityCard(page, full).getByRole('cell').filter({ hasText: '×' }).first()).toBeVisible();
      await expect(facilityCard(page, ineligible).getByRole('cell').filter({ hasText: '—' }).first()).toBeVisible();
      const age = open.vacancies.findIndex((v, a) => v !== null && v > 0 && !open.sharedVacancy?.ages.includes(a));
      await expect(
        facilityCard(page, open).getByRole('cell', { name: new RegExp(`^${age}歳\\s*${open.vacancies[age]}$`) }),
      ).toBeVisible();
      const group = shared.sharedVacancy!;
      await expect(
        facilityCard(page, shared)
          .getByRole('cell')
          .filter({ hasText: `${group.ages.join('・')}歳` }),
      ).toHaveAttribute('title', `${group.ages.join('・')}歳: 空き${group.count}人（共有）`);
      await facilityCard(page, facilities[0]).getByRole('heading').click();
      await expect(facilityCard(page, facilities[0])).toHaveAttribute('aria-current', 'true');
    },
    scope: representativeCardScope,
  },
];

for (const state of accessibilityStates) {
  test(`${state.name}にアクセシビリティ違反がない`, async ({ page }, testInfo) => {
    const reps = accessibilityRepresentatives();
    await page.setViewportSize(state.viewport);
    await state.setup(page, reps);
    const results = await leafletAxe(page, state.fullPage ? [] : await state.scope(page, reps));
    const violations = results.flatMap((result) => result.violations);
    const incomplete = await leafletContrastSummary(page, results);
    await testInfo.attach('axe-color-contrast-incomplete', {
      body: JSON.stringify(incomplete, null, 2),
      contentType: 'application/json',
    });
    if (violations.length > 0) {
      await testInfo.attach('axe', { body: JSON.stringify(violations, null, 2), contentType: 'application/json' });
    }
    const details = violations
      .map((violation) => `${violation.id}: \n${violation.nodes.map((node) => node.target.join(' ')).join('\n')}`)
      .join('\n');
    expect(violations, details).toEqual([]);
  });
}
