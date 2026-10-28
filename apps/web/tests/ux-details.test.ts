import { expect, test, type Page } from '@playwright/test';
import { addStem, addVersion, logIn, removeUser } from './session.js';

let userId: string;
test.beforeEach(async ({ context, baseURL }) => {
  userId = await logIn(context, baseURL!);
});
test.afterEach(() => removeUser(userId));

async function trackPage(page: Page) {
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Fernlicht' } })).json();
  const { track } = await (await page.request.post(`/api/v1/tracks/${project.id}`, { data: { name: 'Nachtbus' } })).json();
  const versionId = addVersion(track.id, userId, 'ready');
  return { projectId: project.id as string, trackId: track.id as string, versionId };
}

test('public pages show without waiting for the login check', async ({ page }) => {
  // The login check never answers
  await page.route('**/api/v1/auth/me', () => {});
  for (const path of ['/upload/unbekannt', '/album/unbekannt', '/abbestellen', '/@niemand']) {
    await page.goto(path);
    await expect(page.locator('.loading-spinner')).toHaveCount(0);
    await expect(page.locator('h1, p').first()).toBeVisible();
  }
});

test('share pages ask search engines to stay away', async ({ page }) => {
  for (const path of ['/listen/unbekannt', '/album/unbekannt']) {
    await page.goto(path);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  }
});

test('the fields stop where the server would refuse', async ({ page }) => {
  const { projectId, trackId } = await trackPage(page);
  await page.goto(`/projects/${projectId}/tracks/${trackId}?upload=version`);
  await expect(page.getByLabel('Versionsbezeichnung')).toHaveAttribute('maxlength', '100');
  await expect(page.locator('.composer input')).toHaveAttribute('maxlength', '5000');
});

test('an open track refuses a new stem file before the upload', async ({ page }) => {
  const { projectId, trackId } = await trackPage(page);
  addStem(trackId, userId, 'Drums');
  await page.route(`**/api/v1/tracks/${trackId}/open`, (route) =>
    route.fulfill({ json: { open: { license: 'cc-by', openedAt: new Date().toISOString(), requestedById: userId, versionId: null, allowedLicenses: ['cc-by'], contributors: [] } } }),
  );
  let uploadRequested = false;
  await page.route('**/upload-url', (route) => {
    uploadRequested = true;
    return route.abort();
  });
  await page.goto(`/projects/${projectId}/tracks/${trackId}`);
  await page.getByRole('button', { name: /1 Spur/ }).click();

  let chooserOpened = false;
  page.on('filechooser', () => (chooserOpened = true));
  await page.getByRole('button', { name: 'Neue Fassung von Drums hochladen' }).click();
  await expect(page.locator('.toast.error')).toContainText('Der Track ist offen. Schließe ihn, um Spuren zu ersetzen.');
  expect(chooserOpened).toBe(false);
  expect(uploadRequested).toBe(false);
});

test('a failed offline download shows as an error', async ({ page }) => {
  const { projectId, trackId, versionId } = await trackPage(page);
  await page.route(`**/api/v1/versions/${versionId}/audio**`, (route) => route.fulfill({ status: 500, body: '' }));
  await page.goto(`/projects/${projectId}/tracks/${trackId}`);
  await page.getByRole('button', { name: 'Weitere Aktionen' }).first().click();
  await page.getByRole('menuitem', { name: 'Offline speichern (MP3)' }).click();
  await expect(page.locator('.toast.error')).toContainText('Download fehlgeschlagen');
  await expect(page.locator('.toast.success')).toHaveCount(0);
});

test.describe(() => {
  // The fake bucket shares the origin here, the service worker would answer the download itself
  test.use({ serviceWorkers: 'block' });

  test('the original downloads in the same window instead of a blocked popup', async ({ page, baseURL }) => {
    const { projectId, trackId, versionId } = await trackPage(page);
    await page.route(`**/api/v1/versions/${versionId}/download-url`, (route) => route.fulfill({ json: { url: `${baseURL}/fake-s3/mix.wav` } }));
    await page.route('**/fake-s3/**', (route) =>
      route.fulfill({ status: 200, headers: { 'content-type': 'audio/wav', 'content-disposition': 'attachment; filename="mix.wav"' }, body: 'RIFF' }),
    );
    await page.goto(`/projects/${projectId}/tracks/${trackId}`);
    let popup = false;
    page.on('popup', () => (popup = true));
    await page.getByRole('button', { name: 'Weitere Aktionen' }).first().click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Original herunterladen' }).click();
    expect((await download).suggestedFilename()).toBe('mix.wav');
    expect(popup).toBe(false);
    await expect(page).toHaveURL(new RegExp(`/tracks/${trackId}`));
  });
});

test('a dialog keeps the focus inside and gives it back when it closes', async ({ page }) => {
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Fernlicht' } })).json();
  await page.goto(`/projects/${project.id}`);
  const opener = page.getByRole('button', { name: 'Upload-Link' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Upload-Link' });
  await expect(dialog).toBeFocused();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('a question comes in our own dialog, Escape there leaves the modal below open', async ({ page }) => {
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Fernlicht' } })).json();
  await page.goto(`/projects/${project.id}`);
  await page.getByRole('button', { name: 'Upload-Link' }).click();
  await page.getByRole('button', { name: 'Link erstellen' }).click();
  const field = page.getByRole('textbox', { name: 'Upload-Link' });
  const first = await field.inputValue();

  page.on('dialog', () => {
    throw new Error('native dialog');
  });
  await page.getByRole('button', { name: 'Neuer Link' }).click();
  const question = page.getByRole('dialog', { name: 'Bist du sicher?' });
  await expect(question).toContainText('Der bisherige funktioniert dann nicht mehr.');
  await page.keyboard.press('Escape');
  await expect(question).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Upload-Link' })).toBeVisible();
  expect(await field.inputValue()).toBe(first);

  await page.getByRole('button', { name: 'Neuer Link' }).click();
  await question.getByRole('button', { name: 'Ja, weiter' }).click();
  await expect(field).not.toHaveValue(first);
});
