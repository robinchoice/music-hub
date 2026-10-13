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

  const row = page.locator('.member-row').filter({ hasText: email });
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
