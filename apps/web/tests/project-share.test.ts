import { expect, test } from '@playwright/test';
import { addVersion, logIn, removeUser } from './session.js';

let userId: string;
let projectId: string;

test.beforeEach(async ({ page, context, baseURL }) => {
  userId = await logIn(context, baseURL!, 'Lena');
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Nachtbus EP' } })).json();
  projectId = project.id;
  for (const name of ['Nachtbus', 'Kreise']) {
    const { track } = await (await page.request.post(`/api/v1/tracks/${project.id}`, { data: { name } })).json();
    addVersion(track.id, userId, 'ready');
  }
  // The test bucket holds no audio
  await page.route('**/api/v1/share/public/*', async (route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    return route.fulfill({ response, json: { ...await response.json(), streamUrl: '/test-audio.wav', waveformUrl: null } });
  });
  await page.route('**/test-audio.wav', (route) => route.fulfill({ body: Buffer.alloc(0), contentType: 'audio/wav' }));
});
test.afterEach(async ({ page }) => {
  // A track request still running when the test ends must not fail it
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  removeUser(userId);
});

test('the share dialog makes one link for the project, which a guest hears song by song', async ({ page, context }) => {
  await page.goto(`/projects/${projectId}`);
  await page.getByRole('button', { name: 'Teilen' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Nachtbus EP teilen' })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Zum Mitarbeiten' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Link kopieren' }).click();
  const field = dialog.getByLabel('Link zum Reinhören');
  await expect(field).toHaveValue(/\/album\/[\w-]+$/);
  await expect(dialog).toContainText('Alle 2 Songs, neue kommen automatisch dazu');
  const url = new URL(await field.inputValue()).pathname;

  await context.clearCookies();
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Nachtbus EP', level: 1 })).toBeVisible();
  const rows = page.locator('.tracklist .row');
  await expect(rows).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Nachtbus', level: 2, exact: true })).toBeVisible();

  await rows.nth(1).click();
  await expect(page.getByRole('heading', { name: 'Kreise', level: 2, exact: true })).toBeVisible();
  const form = page.locator('.comment-form');
  await form.locator('input').fill('Mira');
  await form.locator('textarea').fill('Der Refrain trägt');
  await page.getByRole('button', { name: 'Kommentar speichern', exact: true }).click();
  await expect(page.locator('.comments')).toContainText('Der Refrain trägt');
});

test('a protected project link asks for the password once for all songs', async ({ page, context }) => {
  const { link } = await (await page.request.post(`/api/v1/share/project/${projectId}`, { data: {} })).json();
  await page.request.patch(`/api/v1/share/project-link/${link.id}`, { data: { password: 'nachtbus' } });
  await context.clearCookies();

  await page.goto(`/album/${link.token}`);
  const field = page.getByLabel('Passwort', { exact: true });
  await field.fill('falsch');
  await field.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Das Passwort ist nicht richtig');
  await field.fill('nachtbus');
  await field.press('Enter');
  await expect(page.locator('.tracklist .row')).toHaveCount(2);
  await page.locator('.tracklist .row').nth(1).click();
  await expect(page.getByRole('heading', { name: 'Kreise', level: 2, exact: true })).toBeVisible();
  await expect(field).toHaveCount(0);
});
