import { expect, type Page } from '@playwright/test';
import config from '../playwright.config.ts';

export async function waitForLocation(page: Page) {
  await expect(page.getByRole('status')).toContainText('からの直線距離', {
    timeout: Math.max(10_000, config.expect?.timeout ?? 5_000),
  });
}
