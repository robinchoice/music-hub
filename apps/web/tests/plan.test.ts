import { expect, test } from '@playwright/test';
import { logIn, removeUser, setPlan } from './session.js';

let userId: string;
test.beforeEach(async ({ context, baseURL }) => {
  userId = await logIn(context, baseURL!);
});
test.afterEach(() => removeUser(userId));

test('the account offers Pro and Studio by the year or month, and shows a running plan instead', async ({ page }, info) => {
  await page.goto('/account');
  const card = page.locator('#tarif');
  await expect(card.getByRole('heading', { name: 'Tarif' })).toBeVisible();
  await expect(card.getByText('Gratis', { exact: true })).toBeVisible();
  const prices = card.locator('.price b');
  await expect(prices).toHaveText([/^90\s€$/, /^240\s€$/]);
  await card.getByRole('radio', { name: 'Monatlich' }).click();
  await expect(prices).toHaveText([/^9\s€$/, /^24\s€$/]);
  await expect(card.getByRole('button', { name: 'Mit Karte oder PayPal' })).toHaveCount(2);
  // Nothing sticks out on the phone
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await card.screenshot({ path: info.outputPath('plans.png') });

  setPlan(userId, 'solo');
  await page.reload();
  await expect(card.getByText('Studio, ohne Enddatum')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Mit Karte oder PayPal' })).toHaveCount(0);
});
