import { expect, test } from '@playwright/test';
import { addFile, addVersion, logIn, removeUser } from './session.js';

let userId: string;
test.beforeEach(async ({ context, baseURL }) => {
  userId = await logIn(context, baseURL!);
});
test.afterEach(() => removeUser(userId));

test('a track lists the files filed next to it and takes new ones', async ({ page, baseURL }) => {
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Nachtbus EP' } })).json();
  const track = (await (await page.request.post(`/api/v1/tracks/${project.id}`, { data: { name: 'Letzte Bahn' } })).json()).track;
  const other = (await (await page.request.post(`/api/v1/tracks/${project.id}`, { data: { name: 'Intro' } })).json()).track;
  addVersion(track.id, userId, 'ready');
  addFile(project.id, track.id, userId, 'Letzte Bahn.als');
  addFile(project.id, other.id, userId, 'Intro.als');
  addFile(project.id, null, userId, 'Cover.psd');

  await page.goto(`/projects/${project.id}/tracks/${track.id}`);
  await page.getByRole('button', { name: /1 Datei/ }).click();
  await expect(page.locator('ul.files li b')).toHaveText(['Letzte Bahn.als']);

  await page.route('**/upload-url', (route) => route.fulfill({ json: { uploadUrl: `${baseURL}/fake-s3/lyrics.txt`, fileKey: 'test/lyrics.txt' } }));
  await page.route('**/fake-s3/**', (route) => route.fulfill({ status: 200 }));
  let sent: unknown;
  await page.route(`**/api/v1/files/project/${project.id}`, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    sent = route.request().postDataJSON();
    await route.fulfill({ json: { file: { id: crypto.randomUUID() } } });
  });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Datei hochladen' }).click();
  await (await chooser).setFiles({ name: 'Lyrics.txt', mimeType: 'text/plain', buffer: Buffer.from('la la') });
  await expect(page.locator('.toast-container')).toContainText('Datei hochgeladen');
  expect(sent).toMatchObject({ fileKey: 'test/lyrics.txt', originalFileName: 'Lyrics.txt', trackId: track.id });
});
