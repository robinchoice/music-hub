import { expect, test, type Page } from '@playwright/test';
import { addMember, addUnprocessedVersion, addVersion, logIn, removeUser } from './session.js';

let userId: string;
const others: string[] = [];
test.beforeEach(async ({ context, baseURL }) => {
  userId = await logIn(context, baseURL!, 'Lea Brandt');
});
test.afterEach(() => {
  removeUser(userId);
  while (others.length) removeUser(others.pop()!);
});

async function firstVersion(page: Page) {
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Nachtbus EP' } })).json();
  const { track } = await (await page.request.post(`/api/v1/tracks/${project.id}`, { data: { name: 'Letzte Bahn' } })).json();
  addUnprocessedVersion(track.id, userId);
  return project.id as string;
}

const EMPTY_CARDS = ['Neu zum Anhören', 'Wer ist dran', 'Per Link gehört', 'Lautheit'];

test('brand new: a welcome by name and three steps, the first one carries the only main button', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.locator('.sum')).toHaveText(/^Willkommen, Lea\. In drei Schritten hörst du das erste Feedback/);
  const steps = page.locator('.steps > li');
  await expect(steps).toHaveCount(3);
  await expect(page.locator('.steps .now')).toContainText('Projekt anlegen');
  await expect(page.locator('.btn.primary').filter({ visible: true })).toHaveCount(1);
  await expect(page.locator('.steps .now').getByRole('link', { name: 'Neues Projekt' })).toBeVisible();
  for (const title of [...EMPTY_CARDS, 'Aktivität']) await expect(page.getByRole('heading', { name: title })).toHaveCount(0);
});

test('first track, still alone: no zeros in the week, done steps ticked, inviting comes next', async ({ page }) => {
  const projectId = await firstVersion(page);
  await page.goto('/dashboard');
  await expect(page.locator('.sum')).toContainText('In den letzten sieben Tagen: 1 neue Version. Noch hört niemand mit.');
  await expect(page.locator('.sum')).not.toContainText('Kommentar');
  await expect(page.locator('.steps .done')).toHaveCount(2);
  const next = page.locator('.steps .now');
  await expect(next).toContainText('Leute dazuholen');
  await expect(next.getByRole('link', { name: 'Nachtbus EP teilen' })).toHaveAttribute('href', `/projects/${projectId}/settings`);
  // Only cards with something to show
  for (const title of EMPTY_CARDS) await expect(page.getByRole('heading', { name: title })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Stand der Projekte' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Aktivität' })).toBeVisible();
});

test('"Für dich" alone points to inviting instead of "Alles erledigt"', async ({ page }) => {
  await firstVersion(page);
  await page.goto('/for-you');
  await expect(page.getByRole('heading', { name: 'Noch hört niemand mit' })).toBeVisible();
  await expect(page.getByText('Alles erledigt')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Nachtbus EP teilen' })).toBeVisible();
});

test('once someone else is in a project, the steps are gone', async ({ page }) => {
  others.push(addMember(await firstVersion(page)));
  await page.goto('/dashboard');
  await expect(page.locator('.sum')).toContainText('1 neue Version');
  await expect(page.locator('.sum')).not.toContainText('Noch hört niemand mit');
  await expect(page.locator('.steps')).toHaveCount(0);
  // Lena is to give feedback now
  await expect(page.getByRole('heading', { name: 'Wer ist dran' })).toBeVisible();
});

test('small uploads read in MB instead of 0,00 GB', async ({ page }) => {
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Nachtbus EP' } })).json();
  const { track } = await (await page.request.post(`/api/v1/tracks/${project.id}`, { data: { name: 'Letzte Bahn' } })).json();
  addVersion(track.id, userId, 'ready', 1, Math.round(5.3 * 1024 ** 2));
  await page.goto('/dashboard');
  const card = page.locator('section.card').filter({ has: page.getByRole('heading', { name: 'Speicher' }) });
  await expect(card.locator('.num')).toHaveText(/^5,3 MB/);
  await expect(card).toContainText('Versionen 5,3 MB');
  await expect(card).toContainText('Spuren 0,0 MB');
  await expect(card).not.toContainText('0,00 GB');
});
