import { expect, test, type Page } from '@playwright/test';
import { addUnprocessedVersion, logIn, removeUser } from './session.js';

let userId: string;
test.beforeEach(async ({ context, baseURL }) => {
  userId = await logIn(context, baseURL!);
});
test.afterEach(() => removeUser(userId));

test('a project needs a name, and invalid input reads as German instead of [object Object]', async ({ page }) => {
  await page.goto('/projects/new');
  const create = page.getByRole('button', { name: 'Anlegen' });
  await expect(create).toBeDisabled();
  await page.getByPlaceholder(/Debütalbum/).fill('   ');
  await expect(create).toBeDisabled();

  // The validator answers with an object, not a message
  await page.route('**/api/v1/projects', (route) =>
    route.fulfill({ status: 400, json: { success: false, error: { name: 'ZodError', message: '[]' } } }),
  );
  await page.getByPlaceholder(/Debütalbum/).fill('Nachtbus EP');
  await create.click();
  await expect(page.locator('.toast-container')).toContainText('Bitte prüfe deine Eingaben.');
  await expect(page.locator('.toast-container')).not.toContainText('[object Object]');
});

test('a track needs a name', async ({ page }) => {
  await page.goto('/projects/new');
  await page.getByPlaceholder(/Debütalbum/).fill('Nachtbus EP');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Neuer Track' }).filter({ visible: true }).last().click();
  const form = page.locator('form.new-track-form');
  await expect(form.getByRole('button', { name: 'Anlegen' })).toBeDisabled();
  await form.getByPlaceholder('Track-Name').fill('Letzte Bahn');
  await expect(form.getByRole('button', { name: 'Anlegen' })).toBeEnabled();
});

async function newTrack(page: Page) {
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Nachtbus EP' } })).json();
  const { track } = await (await page.request.post(`/api/v1/tracks/${project.id}`, { data: { name: 'Letzte Bahn' } })).json();
  return { projectId: project.id as string, trackId: track.id as string };
}

test('closing the upload zone cancels the upload, no version turns up later', async ({ page, baseURL }) => {
  const { projectId, trackId } = await newTrack(page);
  await page.route('**/upload-url', (route) =>
    route.fulfill({ json: { uploadUrl: `${baseURL}/fake-s3/mix.wav`, fileKey: 'test/mix.wav', versionId: crypto.randomUUID() } }),
  );
  // The bucket never answers, the upload hangs until it is cancelled
  let aborted = false;
  page.on('requestfailed', (r) => r.url().includes('/fake-s3/') && (aborted = true));
  await page.route('**/fake-s3/**', () => {});
  let registered = false;
  page.on('request', (r) => r.method() === 'POST' && r.url().endsWith(`/api/v1/versions/track/${trackId}`) && (registered = true));

  await page.goto(`/projects/${projectId}/tracks/${trackId}`);
  await page.getByRole('button', { name: 'Version hochladen' }).filter({ visible: true }).first().click();
  await page.locator('.upload-zone input[type=file]').setInputFiles({ name: 'mix.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(64_000) });
  await expect(page.locator('.progress-container')).toBeVisible();
  await page.getByRole('button', { name: 'Upload schließen' }).click();

  await expect(page.locator('.toast-container')).toContainText('Upload abgebrochen');
  await expect.poll(() => aborted).toBe(true);
  expect(registered).toBe(false);
});

test('a finished upload only reports success', async ({ page, baseURL }) => {
  const { projectId, trackId } = await newTrack(page);
  await page.route('**/upload-url', (route) =>
    route.fulfill({ json: { uploadUrl: `${baseURL}/fake-s3/mix.wav`, fileKey: 'test/mix.wav', versionId: crypto.randomUUID() } }),
  );
  await page.route('**/fake-s3/**', (route) => route.fulfill({ status: 200 }));
  await page.route(`**/api/v1/versions/track/${trackId}`, (route) =>
    route.request().method() === 'POST' ? route.fulfill({ json: { version: {} } }) : route.fallback(),
  );
  await page.goto(`/projects/${projectId}/tracks/${trackId}`);
  await page.getByRole('button', { name: 'Version hochladen' }).filter({ visible: true }).first().click();
  await page.locator('.upload-zone input[type=file]').setInputFiles({ name: 'mix.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(64_000) });
  await expect(page.locator('.toast-container')).toContainText('Version hochgeladen');
  await page.waitForTimeout(500);
  await expect(page.locator('.toast-container')).not.toContainText('Upload abgebrochen');
});

test('a file the worker could not read is not shown as ready', async ({ page, baseURL }) => {
  const { projectId, trackId } = await newTrack(page);
  addUnprocessedVersion(trackId, userId);
  // Without an MP3 the page streams the original, here a file that isn't audio
  await page.route('**/stream-url', (route) => route.fulfill({ json: { url: `${baseURL}/fake-s3/kaputt.wav` } }));
  await page.route('**/fake-s3/**', (route) => route.fulfill({ body: 'kaputt', contentType: 'audio/wav' }));
  await page.goto(`/projects/${projectId}/tracks/${trackId}`);
  const card = page.locator('.version-card');
  await expect(card.getByText('Nicht verarbeitet')).toBeVisible();
  await expect(card.getByText('Bereit', { exact: true })).toHaveCount(0);
  await expect(card).toContainText('Die Datei ließ sich nicht verarbeiten');
});

test('form labels name their fields', async ({ page }) => {
  await page.goto('/projects/new');
  await page.getByLabel('Name').fill('Nachtbus EP');
  await page.getByLabel('Beschreibung (optional)').fill('Vier Songs');
  await expect(page.getByPlaceholder(/Debütalbum/)).toHaveValue('Nachtbus EP');
});

test('the closed menu on phones is out of reach for Tab', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'the sidebar is always open on desktop');
  await page.goto('/dashboard');
  const sidebar = page.locator('aside.sidebar');
  await expect(sidebar).toBeHidden();
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('aside.sidebar'))).toBe(false);
  }
  await page.getByRole('button', { name: 'Menü öffnen' }).click();
  await expect(sidebar).toBeVisible();
});

test('the sidebar shows a new track right away', async ({ page, isMobile }) => {
  await page.goto('/projects/new');
  await page.getByLabel('Name').fill('Nachtbus EP');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Neuer Track' }).filter({ visible: true }).last().click();
  await page.getByPlaceholder('Track-Name').fill('Letzte Bahn');
  await page.getByPlaceholder('Track-Name').press('Enter');
  await expect(page.locator('.toast-container')).toContainText('Track angelegt');
  if (isMobile) await page.getByRole('button', { name: 'Menü öffnen' }).click();
  await expect(page.locator('aside.sidebar').getByText('Letzte Bahn')).toBeVisible();
});
