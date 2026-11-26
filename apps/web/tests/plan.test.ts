import { expect, test } from '@playwright/test';
import { logIn, removeUser, setPlan, setSubscription } from './session.js';

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
  const buy = card.getByRole('button', { name: 'Mit Karte oder PayPal' });
  await expect(buy).toHaveCount(2);
  // Buying waits for the express request to start right away
  await expect(buy.first()).toBeDisabled();
  await card.getByRole('checkbox', { name: /Ich verlange ausdrücklich/ }).check();
  await expect(buy.first()).toBeEnabled();
  // Nothing sticks out on the phone
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await card.screenshot({ path: info.outputPath('plans.png') });

  setPlan(userId, 'solo');
  await page.reload();
  await expect(card.getByText('Studio, ohne Enddatum')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Mit Karte oder PayPal' })).toHaveCount(0);

  // A free month from an admin: the subscription of the same plan starts charging when it ends
  setPlan(userId, 'solo', 30);
  await page.reload();
  await expect(card.getByText(/^Studio bis /)).toBeVisible();
  await expect(card.getByRole('button', { name: 'Mit Karte oder PayPal weiterführen' })).toHaveCount(1);
  await expect(card.getByText(/^Erste Abbuchung am /)).toBeVisible();
  await expect(card.getByRole('radio', { name: 'Monatlich' })).toBeChecked();
  await expect(card.locator('.price b')).toHaveText([/^24\s€$/]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('the terms are public while plans are for sale, and a subscription is cancelled in two steps', async ({ page }) => {
  await page.goto('/agb');
  await expect(page.getByRole('heading', { name: '§ 6 Laufzeit, Kündigung, Ende eines Tarifs' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Widerrufsbelehrung' })).toBeVisible();
  await page.goto('/datenschutz');
  await expect(page.getByRole('heading', { name: '13. Tarife und Zahlungen' })).toBeVisible();

  setSubscription(userId, 'sub_e2e');
  await page.goto('/account');
  const card = page.locator('#tarif');
  await card.getByRole('button', { name: 'Verträge hier kündigen' }).click();
  await expect(card.getByRole('button', { name: 'Jetzt kündigen' })).toBeVisible();
  await card.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(card.getByRole('button', { name: 'Verträge hier kündigen' })).toBeVisible();
});
