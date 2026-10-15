import { expect, test } from '@playwright/test';
import { logIn, mailTokenOf, removeUser, updatesOf } from './session.js';

const users: string[] = [];
test.afterEach(() => {
  for (const id of users.splice(0)) removeUser(id);
});

test('the login form asks for update mails without a preset tick, the link confirms it', async ({ page, browser, baseURL }) => {
  // An existing account, a full Music Hub turns new addresses away
  const other = await browser.newContext();
  const id = await logIn(other, baseURL!);
  users.push(id);
  await other.close();

  await page.goto('/login?tab=magic');
  const optIn = page.getByRole('checkbox', { name: /Schick mir Updates/ });
  await expect(optIn).not.toBeChecked();
  await page.getByLabel('E-Mail').fill(updatesOf(id).email);
  await optIn.check();
  await page.getByRole('button', { name: 'Login-Link senden' }).click();
  await expect(page.getByText('Check deine E-Mails')).toBeVisible();

  // Counts only once the link is opened
  expect(updatesOf(id)).toMatchObject({ optIn: true, consent: null });
});

test('update mails turn on in the account and off through the link in the mail', async ({ page, context, baseURL }) => {
  const id = await logIn(context, baseURL!);
  users.push(id);
  await page.goto('/account');
  const updates = page.getByRole('checkbox', { name: /Updates per Mail/ });
  await expect(updates).not.toBeChecked();
  await updates.check();
  await expect(page.getByText('Eingeschaltet am', { exact: false })).toBeVisible();
  expect(updatesOf(id).consent).not.toBeNull();

  await page.goto(`/abbestellen?liste=updates&t=${mailTokenOf(id)}`);
  await expect(page.getByRole('heading', { name: 'Updates per Mail' })).toBeVisible();
  await page.getByRole('button', { name: 'Abbestellen' }).click();
  await expect(page.getByText('Abbestellt.')).toBeVisible();
  expect(updatesOf(id).consent).toBeNull();
  await page.getByRole('button', { name: 'Doch wieder bestellen' }).click();
  await expect(page.getByText('Wieder bestellt.')).toBeVisible();
  expect(updatesOf(id).consent).not.toBeNull();
});

test('admins write an update and see the mail as recipients will', async ({ page, context, baseURL }, testInfo) => {
  const id = await logIn(context, baseURL!, 'Admin', `e2e-admin-${testInfo.project.name}@example.com`);
  users.push(id);
  await page.goto('/admin/updates');
  await page.getByRole('button', { name: 'Neues Update' }).click();
  const title = `Spuren als ZIP (${testInfo.project.name})`;
  await page.getByLabel('Titel').fill(title);
  await page.getByLabel('Features, eins pro Zeile').fill('Ein Klick lädt alle Spuren');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('button', { name: title })).toBeVisible();
  await expect(page.frameLocator('iframe[title="Vorschau"]').getByText('Ein Klick lädt alle Spuren')).toBeVisible();
  await page.getByRole('button', { name: 'Entwurf löschen' }).click();
  await expect(page.getByRole('button', { name: title })).toHaveCount(0);
});

test('the admin page stays closed to everyone else', async ({ page, context, baseURL }) => {
  users.push(await logIn(context, baseURL!));
  expect((await page.request.get('/api/v1/updates')).status()).toBe(403);
  await page.goto('/admin/updates');
  await expect(page).toHaveURL(/\/dashboard$/);
});
