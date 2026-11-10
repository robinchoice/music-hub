import { expect, test } from '@playwright/test';
import { logIn, removeEmail, removeUser } from './session.js';

let userId: string;
const email = `test-${crypto.randomUUID()}@example.com`;
test.beforeEach(async ({ context, baseURL }) => {
  userId = await logIn(context, baseURL!);
});
test.afterEach(() => {
  removeUser(userId);
  removeEmail(email);
});

test('one person can hold several roles in a project', async ({ page }, info) => {
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Nachtbus EP' } })).json();
  await page.goto(`/projects/${project.id}/settings`);

  const form = page.locator('.invite-form');
  await form.getByPlaceholder('name@email.de').fill(email);
  await form.getByRole('button', { name: 'Mixing' }).click();
  await form.getByRole('button', { name: 'Mastering' }).click();
  await form.getByRole('button', { name: 'Einladen' }).click();

  // The new account has not logged in yet, so the list names it by its address
  const listed = page.locator('.member-row').filter({ hasText: email });
  await expect(listed).toContainText('Einladung offen');
  await expect(listed).toContainText('Mixing');
  await page.getByRole('button', { name: `${email} bearbeiten` }).click();
  const row = page.getByRole('dialog');
  for (const name of ['Artist', 'Mixing', 'Mastering']) {
    await expect(row.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  await page.screenshot({ path: info.outputPath('roles.png'), fullPage: true });

  // Taking roles away down to the last one, which stays
  await row.getByRole('button', { name: 'Artist', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Artist', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await row.getByRole('button', { name: 'Mixing', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Mastering', exact: true })).toBeDisabled();

  const { members } = await (await page.request.get(`/api/v1/projects/${project.id}/members`)).json();
  const member = members.find((m: { user: { email: string } }) => m.user.email === email);
  expect(member).toMatchObject({ role: 'mastering_engineer', roles: ['mastering_engineer'], canUpload: true, canApprove: false });
});

test('the owner changes single rights of a person and resets them to the roles', async ({ page }) => {
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Nachtbus EP' } })).json();
  await page.request.post(`/api/v1/projects/${project.id}/members`, { data: { email, roles: ['label'] } });
  await page.goto(`/projects/${project.id}/settings`);

  await page.getByRole('button', { name: `${email} bearbeiten` }).click();
  const dialog = page.getByRole('dialog');
  const download = dialog.getByRole('switch', { name: /Originale herunterladen/ });
  await expect(download).not.toBeChecked();
  await download.check();
  await expect(page.locator('.member-row').filter({ hasText: email })).toContainText('Rechte angepasst');

  const memberOf = async () =>
    ((await (await page.request.get(`/api/v1/projects/${project.id}/members`)).json()).members as { user: { email: string } }[]).find(
      (m) => m.user.email === email,
    );
  expect(await memberOf()).toMatchObject({ role: 'label', canDownload: true, canApprove: true });

  await dialog.getByRole('button', { name: 'Auf Vorgabe der Rollen zurücksetzen' }).click();
  await expect(download).not.toBeChecked();
  expect(await memberOf()).toMatchObject({ role: 'label', canDownload: false });
});
