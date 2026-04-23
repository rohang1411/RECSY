import { expect, test } from '@playwright/test';

test.describe('Phone page (SSR)', () => {
  test('loads a seeded active phone', async ({ page }) => {
    await page.goto('/p/apple-iphone-16-pro');
    await expect(page.getByRole('heading', { name: 'iPhone 16 Pro' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ask about this phone' })).toBeVisible();
  });
});
