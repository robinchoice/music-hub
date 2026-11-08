import { expect, test } from '@playwright/test';
import { logIn, removeUser } from './session.js';

let userId: string;
test.beforeEach(async ({ context, baseURL }) => {
  userId = await logIn(context, baseURL!);
});
test.afterEach(() => removeUser(userId));

test('moving a track to the trash shows no error afterwards', async ({ page }) => {
  test.setTimeout(30_000);
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Nachtbus EP' } })).json();
  await page.request.post(`/api/v1/tracks/${project.id}`, { data: { name: 'Letzte Bahn' } });
  // Coming from the project page mounts the track page twice; the first one must not keep polling
  await page.goto(`/projects/${project.id}`);
  await page.getByRole('link', { name: /Letzte Bahn/ }).first().click();
  await page.getByRole('button', { name: 'Track-Aktionen' }).click();
  const missing: string[] = [];
  page.on('response', (r) => {
    if (r.status() === 404) missing.push(r.url());
  });
  await page.getByRole('menuitem', { name: /Papierkorb/ }).click();
  await expect(page).toHaveURL(`/projects/${project.id}`);
  await expect(page.locator('.toast-container')).toContainText('liegt im Papierkorb');
  // The track page polled every 5 seconds
  await page.waitForTimeout(6000);
  expect(missing).toEqual([]);
  await expect(page.locator('.toast.error')).toHaveCount(0);
});

test('the settings offer the project details only to whom may change them', async ({ page, browser, baseURL }) => {
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Nachtbus EP', description: 'Fünf Songs' } })).json();
  await page.goto(`/projects/${project.id}/settings`);
  const name = page.getByLabel('Name', { exact: true });
  await name.fill('');
  await expect(page.getByRole('button', { name: 'Speichern' })).toBeDisabled();
  await name.fill('Nachtbus');
  await expect(page.getByRole('button', { name: 'Speichern' })).toBeEnabled();

  const other = await browser.newContext();
  const email = `test-${crypto.randomUUID()}@example.com`;
  const otherId = await logIn(other, baseURL!, 'Lena', email);
  try {
    await page.request.post(`/api/v1/projects/${project.id}/members`, { data: { email, roles: ['management'] } });
    const lena = await other.newPage();
    await lena.goto(`/projects/${project.id}/settings`);
    await expect(lena.getByText('Fünf Songs')).toBeVisible();
    await expect(lena.getByLabel('Name', { exact: true })).toHaveCount(0);
    await expect(lena.getByRole('button', { name: 'Speichern' })).toHaveCount(0);
    await expect(lena.locator('.cover-upload')).toHaveCount(0);
    // Management still invites
    await expect(lena.getByRole('button', { name: 'Einladen' })).toBeVisible();
  } finally {
    await other.close();
    removeUser(otherId);
  }
});

test('an archived project still lists its tracks', async ({ page }) => {
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Nachtbus EP' } })).json();
  const { track } = await (await page.request.post(`/api/v1/tracks/${project.id}`, { data: { name: 'Letzte Bahn' } })).json();
  await page.request.delete(`/api/v1/projects/${project.id}`);
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByRole('status')).toContainText('archiviert');
  await expect(page.getByText('Noch keine Tracks')).toHaveCount(0);
  await page.getByRole('link', { name: 'Letzte Bahn' }).click();
  await expect(page).toHaveURL(`/projects/${project.id}/tracks/${track.id}`);
});

test('the cover field says what it does without hovering', async ({ page }) => {
  await page.goto('/projects/new');
  const overlay = page.locator('.cover-upload .overlay');
  await expect(overlay).toContainText('Cover hinzufügen');
  await expect(overlay).toHaveCSS('opacity', '1');
});

test('the project tabs stay on one line', async ({ page }) => {
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Nachtbus EP' } })).json();
  await page.goto(`/projects/${project.id}`);
  const tabs = page.getByRole('tab');
  // Owners see five tabs, Auftrag included
  await expect(tabs).toHaveCount(5);
  const tops = await tabs.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
});
