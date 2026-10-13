import { expect, test } from '@playwright/test';
import { logIn, removeUser } from './session.js';

let userId: string;
test.beforeEach(async ({ context, baseURL }) => {
  userId = await logIn(context, baseURL!);
});
test.afterEach(() => removeUser(userId));

test('an archived project waits in the archive and comes back from there', async ({ page }) => {
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Nachtbus EP' } })).json();
  await page.goto(`/projects/${project.id}/settings`);
  await page.getByRole('button', { name: 'Archivieren' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Archivieren' }).click();
  await expect(page).toHaveURL('/dashboard');

  await page.goto('/archive');
  await expect(page.getByText('Nachtbus EP')).toBeVisible();
  await page.getByRole('button', { name: 'Wiederherstellen' }).click();
  await expect(page.locator('.toast-container')).toContainText('„Nachtbus EP“ ist wieder da');
  await expect(page.getByText('Das Archiv ist leer')).toBeVisible();

  const { projects } = await (await page.request.get('/api/v1/projects')).json();
  expect(projects.map((m: { project: { id: string } }) => m.project.id)).toContain(project.id);
});
