import { expect, test } from '@playwright/test';

test('the register page links imprint and privacy policy', async ({ page }) => {
  await page.goto('/register');
  await expect(page.getByRole('link', { name: 'Impressum' })).toHaveAttribute('href', '/impressum');
  await expect(page.getByRole('link', { name: 'Datenschutz' })).toHaveAttribute('href', '/datenschutz');
});
