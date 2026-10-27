import { defineConfig, devices } from '@playwright/test';

const port = 4173;

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // 遅い CI の runner では全施設（1109件）の描画が既定の5秒を超えることがある
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // ビルド成果物の設定を実行せず、ソース設定と検証対象の assets を使う
    command: `${process.env.PLAYWRIGHT_SKIP_BUILD ? '' : 'pnpm build && '}pnpm exec wrangler dev --config wrangler.jsonc --assets dist --local --persist-to .wrangler/state --ip 127.0.0.1 --port ${port}`,
    url: `http://localhost:${port}`,
  },
});
