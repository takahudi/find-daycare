import { expect, test } from '@playwright/test';

for (const path of ['/assets/facilities-doesnotexist.json', '/foo']) {
  test(path + ' はHTMLへフォールバックせず404を返す', async ({ request }) => {
    const response = await request.get(path, { headers: { 'Sec-Fetch-Mode': 'cors' } });
    expect(response.status()).toBe(404);
    expect(await response.text()).not.toContain('id="root"');
  });
}
