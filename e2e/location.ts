import { expect, type Page } from '@playwright/test';
import config from '../playwright.config.ts';

export async function waitForLocation(page: Page) {
  // 非配列の失敗診断は未出現時に全カードを走査するため、配列で件数と内容を一緒に待つ。
  await expect(page.getByRole('status')).toHaveText([/からの直線距離/], {
    timeout: Math.max(10_000, config.expect?.timeout ?? 5_000),
  });
}
