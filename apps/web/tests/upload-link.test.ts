import { expect, test } from '@playwright/test';
import { logIn, removeUser } from './session.js';

let userId: string;
test.beforeEach(async ({ context, baseURL }) => {
  userId = await logIn(context, baseURL!, 'Robin Choice');
});
test.afterEach(() => removeUser(userId));

test('a guest without an account sends stems for a new song through the upload link', async ({ page, browser, baseURL }) => {
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Fernlicht', artist: 'Tiefgang' } })).json();
  await page.request.post(`/api/v1/tracks/${project.id}`, { data: { name: 'Nachtbus' } });

  await page.goto(`/projects/${project.id}`);
  await page.getByRole('button', { name: 'Upload-Link' }).click();
  await page.getByRole('button', { name: 'Link erstellen' }).click();
  const url = await page.getByLabel('Upload-Link').inputValue();
  expect(url).toMatch(new RegExp(`^${baseURL}/upload/\\w+$`));

  const guest = await browser.newContext({ baseURL });
  const guestPage = await guest.newPage();
  await guestPage.route('**/upload-url', (route) => route.fulfill({ json: { uploadUrl: `${baseURL}/fake-s3/drums.wav`, fileKey: 'test/drums.wav' } }));
  await guestPage.route('**/fake-s3/**', (route) => route.fulfill({ status: 200 }));
  let sent: unknown;
  await guestPage.route(/\/api\/v1\/upload-links\/public\/\w+\/track\/[\w-]+$/, async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { stem: { id: crypto.randomUUID() } } });
  });

  await guestPage.goto(url);
  await expect(guestPage.locator('.lead')).toContainText('Robin Choice hat dich eingeladen');
  await guestPage.getByLabel('Dein Name').fill('Kai');
  await guestPage.getByLabel('Für welchen Song?').fill('nachtbus');
  await expect(guestPage.locator('.hint')).toHaveText('Die Dateien kommen zu „Nachtbus“.');
  await guestPage.getByLabel('Für welchen Song?').fill('Kreide');
  await expect(guestPage.locator('.hint')).toHaveText('„Kreide“ wird als neuer Song angelegt.');
  await guestPage.getByLabel('Notiz an Robin Choice (optional)').fill('Gesang bitte etwas lauter');
  await guestPage.getByRole('button', { name: 'Weiter' }).click();

  const chooser = guestPage.waitForEvent('filechooser');
  await guestPage.locator('.dropzone').click();
  await (await chooser).setFiles({ name: 'drums.wav', mimeType: 'audio/wav', buffer: Buffer.from('RIFF') });
  await expect(guestPage.locator('.done')).toContainText('Angekommen: Kreide');
  expect(sent).toMatchObject({ guestName: 'Kai', name: 'drums', fileKey: 'test/drums.wav' });
  await guest.close();

  // The new song is in the project, created in the name of the link's owner
  const { tracks } = await (await page.request.get(`/api/v1/tracks/project/${project.id}`)).json();
  expect(tracks.map((t: { name: string }) => t.name).sort()).toEqual(['Kreide', 'Nachtbus']);

  // The note waits with the song's stems
  const kreide = tracks.find((t: { name: string }) => t.name === 'Kreide');
  await page.goto(`/projects/${project.id}/tracks/${kreide.id}`);
  await page.getByRole('button', { name: /0 Spuren/ }).click();
  await expect(page.getByRole('list', { name: 'Notizen von Gästen' }).first()).toContainText('Kai');
  await expect(page.getByRole('list', { name: 'Notizen von Gästen' }).first()).toContainText('Gesang bitte etwas lauter');
});

test('the account decides whether guests may upload and how much', async ({ page }) => {
  await page.goto('/account');
  const allowed = page.getByLabel('Gäste ohne Konto dürfen hochladen');
  await expect(allowed).toBeChecked();
  await expect(page.getByLabel('Höchstens')).toHaveValue(String(2 * 1024 ** 3));
  await page.getByLabel('Höchstens').selectOption({ label: '5 GB' });
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/v1/upload-links/settings') && r.request().method() === 'PATCH');
  await allowed.uncheck();
  await saved;
  await page.reload();
  await expect(page.getByLabel('Gäste ohne Konto dürfen hochladen')).not.toBeChecked();
  await expect(page.getByLabel('Höchstens')).toHaveCount(0);
});

test('an unknown upload link says so', async ({ page }) => {
  await page.goto('/upload/0000');
  await expect(page.getByRole('heading', { name: 'Link nicht verfügbar' })).toBeVisible();
});
