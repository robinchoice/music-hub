import { expect, test, type Page } from '@playwright/test';
import { addStem, addVersion, logIn, removeUser } from './session.js';

let userId: string;
test.beforeEach(async ({ context, baseURL }) => {
  userId = await logIn(context, baseURL!);
});
test.afterEach(() => removeUser(userId));

let projectId: string;
async function trackWithStem(page: Page, earlier: number) {
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Nachtbus EP' } })).json();
  const { track } = await (await page.request.post(`/api/v1/tracks/${project.id}`, { data: { name: 'Letzte Bahn' } })).json();
  projectId = project.id;
  addVersion(track.id, userId, 'ready');
  const stemId = addStem(track.id, userId, 'Drums', earlier);
  await page.goto(`/projects/${project.id}/tracks/${track.id}`);
  await page.getByRole('button', { name: /1 Spur/ }).click();
  return stemId;
}

test('a stem gets a new file and then counts its takes', async ({ page, baseURL }) => {
  const stemId = await trackWithStem(page, 0);
  await expect(page.getByRole('button', { name: /^Fassung/ })).toHaveCount(0);

  await page.route('**/upload-url', (route) => route.fulfill({ json: { uploadUrl: `${baseURL}/fake-s3/drums.wav`, fileKey: 'test/drums.wav' } }));
  await page.route('**/fake-s3/**', (route) => route.fulfill({ status: 200 }));
  let sent: unknown;
  await page.route(`**/api/v1/stems/${stemId}/replace`, async (route) => {
    sent = route.request().postDataJSON();
    const stem = { id: stemId, name: 'Drums', originalFileName: 'drums-cut.wav', mimeType: 'audio/wav', fileSize: 4, createdById: userId, createdAt: new Date().toISOString() };
    await route.fulfill({ json: { stem } });
  });

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Neue Fassung von Drums hochladen' }).click();
  await (await chooser).setFiles({ name: 'drums-cut.wav', mimeType: 'audio/wav', buffer: Buffer.from('RIFF') });

  await expect(page.locator('.toast-container')).toContainText('Neue Fassung von „Drums“ hochgeladen');
  await expect(page.getByRole('button', { name: 'Fassung 2' })).toBeVisible();
  expect(sent).toEqual({ fileKey: 'test/drums.wav', originalFileName: 'drums-cut.wav', mimeType: 'audio/wav' });
});

test('an earlier take can become the current one again', async ({ page }) => {
  await trackWithStem(page, 1);
  await page.getByRole('button', { name: 'Fassung 2' }).click();
  await expect(page.getByText('Fassung 1 · Testperson')).toBeVisible();

  await page.getByRole('button', { name: 'Fassung 1 wiederherstellen' }).click();
  await expect(page.locator('.toast-container')).toContainText('„Drums-take1.wav“ ist wieder die aktuelle Fassung');
  // The file that was current is now the earlier one
  await expect(page.locator('li.revision')).toHaveAttribute('title', 'Drums.wav');
  await expect(page.getByRole('button', { name: 'Fassung 2' })).toBeVisible();
});

test('an earlier take goes into the trash and comes back from there', async ({ page }) => {
  await trackWithStem(page, 2);
  await page.getByRole('button', { name: 'Fassung 3' }).click();
  await page.getByRole('button', { name: 'Fassung 1 in den Papierkorb' }).click();
  await expect(page.locator('.toast-container')).toContainText('Fassung 1 von „Drums“ liegt im Papierkorb des Projekts');
  await expect(page.getByRole('button', { name: 'Fassung 2', exact: true })).toBeVisible();
  await expect(page.locator('li.revision')).toHaveCount(1);

  await page.goto(`/projects/${projectId}/trash`);
  await page.getByRole('tab', { name: /Fassungen/ }).click();
  await expect(page.getByText('Frühere Fassung von Drums')).toBeVisible();
  await page.getByRole('button', { name: 'Wiederherstellen' }).click();
  await expect(page.locator('.toast-container')).toContainText('Fassung „Drums-take1.wav“ ist wieder da');
});
