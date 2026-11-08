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
