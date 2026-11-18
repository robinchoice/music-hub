import { expect, test, type Page } from '@playwright/test';
import { logIn, removeUser } from './session.js';

const ids: string[] = [];
test.afterEach(() => { for (const id of ids.splice(0)) removeUser(id); });

async function openAccountMenu(page: Page, isMobile: boolean) {
  if (isMobile) await page.getByRole('button', { name: 'Menü öffnen' }).click();
  await page.locator('aside.sidebar button.user').click();
  return page.locator('aside.sidebar .menu');
}

test('two accounts in one browser: add, switch and log out one after the other', async ({ page, context, baseURL, isMobile }) => {
  const admin = `admin-${crypto.randomUUID()}@example.com`;
  ids.push(await logIn(context, baseURL!, 'Robin Admin', admin));
  await page.goto('/dashboard');

  // Adding sets the admin aside, the login page offers the way back
  await (await openAccountMenu(page, isMobile)).getByRole('button', { name: 'Konto hinzufügen' }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('button', { name: `Weiter als ${admin}` })).toBeVisible();

  // Signing in the second account, as the login does
  ids.push(await logIn(context, baseURL!, 'Robin Privat'));
  await page.goto('/dashboard');
  let menu = await openAccountMenu(page, isMobile);
  await expect(menu.locator('.account-text > span')).toHaveText(['Robin Privat', 'Robin Admin']);
  await menu.getByRole('button', { name: /Robin Admin/ }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  menu = await openAccountMenu(page, isMobile);
  await expect(menu.locator('[aria-current="true"]')).toContainText('Robin Admin');

  // Logging out hands over to the other account, the second time ends at the login
  await menu.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  menu = await openAccountMenu(page, isMobile);
  await expect(page.locator('aside.sidebar .user-name')).toHaveText('Robin Privat');
  await expect(menu.getByRole('button', { name: 'Alle Konten abmelden' })).toHaveCount(0);
  await menu.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('button', { name: /^Weiter als/ })).toHaveCount(0);
});
