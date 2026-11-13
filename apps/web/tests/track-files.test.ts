import { expect, test } from '@playwright/test';
import { addFile, addMeasurements, addStem, addVersion, logIn, removeUser } from './session.js';

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

test('a project opens from Meine Musik with its tracks as folders of versions, stems and files', async ({ page, isMobile }) => {
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Nachtbus EP', artist: 'Tiefgang' } })).json();
  const track = (await (await page.request.post(`/api/v1/tracks/${project.id}`, { data: { name: 'Letzte Bahn' } })).json()).track;
  await page.request.post(`/api/v1/tracks/${project.id}`, { data: { name: 'Intro' } });
  addVersion(track.id, userId, 'ready');
  addStem(track.id, userId, 'Bass');
  addFile(project.id, track.id, userId, 'Letzte Bahn.als');
  addFile(project.id, null, userId, 'Cover.psd');

  await page.goto('/artists/Tiefgang');
  await page.locator('.folders .folder').filter({ hasText: 'Nachtbus EP' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}\?view=dateien$/);
  // The tab counts what it shows: two track folders and one file without a track
  await expect(page.getByRole('tab', { name: 'Ordner 3' })).toBeVisible();
  const folders = page.locator('.folders .folder');
  await expect(folders.locator('.name b')).toHaveText(['Letzte Bahn', 'Intro']);
  if (!isMobile) await expect(folders.locator('.contents')).toHaveText(['1 Version · 1 Datei', '0 Versionen']);
  // Files of a track sit in its folder, the project keeps the rest
  await expect(page.locator('ul.files li b')).toHaveText(['Cover.psd']);

  await folders.filter({ hasText: 'Letzte Bahn' }).click();
  await expect(page).toHaveURL(new RegExp(`/tracks/${track.id}/files$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Letzte Bahn');
  await expect(page.getByRole('region', { name: /Versionen/ }).locator('.version b')).toHaveText(['V1 · mix']);
  await expect(page.getByRole('region', { name: /Spuren/ })).toContainText('Bass');
  await expect(page.getByRole('region', { name: /Dateien/ }).locator('ul.files li b')).toHaveText(['Letzte Bahn.als']);
  if (!isMobile) {
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumbs.getByRole('link')).toHaveText(['Meine Musik', 'Tiefgang', 'Nachtbus EP']);
  }

  await page.getByRole('link', { name: 'Im Player öffnen' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/tracks/${track.id}$`));
});

test('an audio file of the project becomes its reference, and the version page compares with it', async ({ page }) => {
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Nachtbus EP' } })).json();
  const track = (await (await page.request.post(`/api/v1/tracks/${project.id}`, { data: { name: 'Letzte Bahn' } })).json()).track;
  addMeasurements('versions', addVersion(track.id, userId, 'ready'), -30, -14);
  const reference = addFile(project.id, null, userId, 'Vorbild.wav', 'audio/wav');
  addFile(project.id, null, userId, 'Cover.psd');

  await page.goto(`/projects/${project.id}?view=dateien`);
  // Only audio can be the reference
  await expect(page.getByRole('button', { name: /als Referenz des Projekts/ })).toHaveCount(1);
  await page.getByRole('button', { name: /Vorbild\.wav als Referenz des Projekts/ }).click();
  await expect(page.locator('.toast-container')).toContainText('Vorbild.wav ist jetzt die Referenz');
  await expect(page.getByRole('button', { name: /Vorbild\.wav ist die Referenz des Projekts/ })).toHaveAttribute('aria-pressed', 'true');

  await page.goto(`/projects/${project.id}/tracks/${track.id}`);
  const measurements = page.locator('.measurements');
  await measurements.locator('summary').click();
  await expect(measurements).toContainText('Die Referenz Vorbild.wav wird noch gemessen.');

  addMeasurements('projectFiles', reference, -32, -10);
  await page.reload();
  await page.locator('.measurements summary').click();
  await expect(page.getByRole('heading', { name: 'Gegenüber der Referenz Vorbild.wav, gleich laut gemacht' })).toBeVisible();
  await expect(page.locator('.measurements')).toContainText('Lautheit −4,0 LU');
});
