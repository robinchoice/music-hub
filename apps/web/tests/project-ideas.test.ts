import { expect, test, type Page } from '@playwright/test';
import { logIn, removeUser } from './session.js';

let userId: string;
test.beforeEach(async ({ context, baseURL }) => {
  userId = await logIn(context, baseURL!);
});
test.afterEach(() => removeUser(userId));

const memberCount = async (page: Page, projectId: string) =>
  ((await (await page.request.get(`/api/v1/projects/${projectId}/members`)).json()) as { members: unknown[] }).members.length;

test('contributors: roles explain themselves, open invitations show, removing can be undone', async ({ page }) => {
  test.setTimeout(40_000);
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Nachtbus EP' } })).json();
  const email = `test-${crypto.randomUUID()}@example.com`;
  await page.request.post(`/api/v1/projects/${project.id}/members`, { data: { email, roles: ['mixing_engineer'] } });
  await page.goto(`/projects/${project.id}/settings`);

  // The owner comes first, the invitation is marked as open
  await expect(page.locator('.member-row').first()).toContainText('Besitzer');
  const row = page.locator('.member-row').filter({ hasText: email });
  await expect(row).toContainText('Einladung offen');
  // Every role says what it may do
  await expect(page.locator('.invite-form').getByText('Rollen · mehrere möglich')).toBeVisible();
  await expect(page.locator('.invite-form').getByRole('button', { name: 'Label' })).toHaveAccessibleDescription('gibt frei, ohne Download');

  // Removing waits for the undo toast
  await page.getByRole('button', { name: `${email} bearbeiten` }).click();
  await page.getByRole('button', { name: 'Aus dem Projekt entfernen' }).click();
  await expect(row).toHaveCount(0);
  await page.locator('.toast-container').getByRole('button', { name: 'Rückgängig' }).click();
  await expect(row).toBeVisible();
  expect(await memberCount(page, project.id)).toBe(2);

  // Without undo it is gone once the toast is over
  await page.getByRole('button', { name: `${email} bearbeiten` }).click();
  await page.getByRole('button', { name: 'Aus dem Projekt entfernen' }).click();
  await expect.poll(() => memberCount(page, project.id), { timeout: 12_000 }).toBe(1);
});

test('leaving the settings removes at once what waits for undo', async ({ page }) => {
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Nachtbus EP' } })).json();
  const email = `test-${crypto.randomUUID()}@example.com`;
  await page.request.post(`/api/v1/projects/${project.id}/members`, { data: { email, roles: ['artist'] } });
  await page.goto(`/projects/${project.id}/settings`);
  await page.getByRole('button', { name: `${email} bearbeiten` }).click();
  await page.getByRole('button', { name: 'Aus dem Projekt entfernen' }).click();
  await page.goto(`/projects/${project.id}`);
  await expect.poll(() => memberCount(page, project.id), { timeout: 3000 }).toBe(1);
});
