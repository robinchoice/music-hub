import { expect, test } from '@playwright/test';
import { logIn, removeUser } from './session.js';

let userId: string;
test.beforeEach(async ({ context, baseURL }) => {
  userId = await logIn(context, baseURL!);
});
test.afterEach(() => removeUser(userId));

test('a new track starts as Demo and moves through the production stages', async ({ page }) => {
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Fernlicht' } })).json();
  const { track } = await (await page.request.post(`/api/v1/tracks/${project.id}`, { data: { name: 'Nachtbus' } })).json();
  await page.goto(`/projects/${project.id}/tracks/${track.id}`);

  await page.locator('.status-trigger').click();
  await expect(page.locator('.status-menu button')).toHaveText(['Demo', 'Recording', 'Mix', 'Master', 'Final', 'Veröffentlicht']);
  await expect(page.locator('.status-menu button.active')).toHaveText('Demo');
  await page.locator('.status-menu button', { hasText: 'Mix' }).click();
  await expect(page.locator('.status-trigger')).toHaveText('Mix');
  await page.reload();
  await expect(page.locator('.status-trigger')).toHaveText('Mix');
});
