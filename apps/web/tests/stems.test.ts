import { expect, test, type Page } from '@playwright/test';
import { addStem, addVersion, logIn, removeUser } from './session.js';

test.use({ serviceWorkers: 'block' });

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
  await expect(page.locator('.toast-container')).toContainText('Fassung 1 von „Drums“ liegt im Papierkorb');
  await expect(page.getByRole('button', { name: 'Fassung 2', exact: true })).toBeVisible();
  await expect(page.locator('li.revision')).toHaveCount(1);

  // The old address leads to the trash with this project selected
  await page.goto(`/projects/${projectId}/trash`);
  await expect(page).toHaveURL(`/trash?project=${projectId}`);
  await page.getByRole('tab', { name: /Fassungen/ }).click();
  await expect(page.getByText('Frühere Fassung von Drums')).toBeVisible();
  await page.getByRole('button', { name: 'Wiederherstellen' }).click();
  await expect(page.locator('.toast-container')).toContainText('Fassung „Drums-take1.wav“ ist wieder da');
});

test('a stem-only track picks up its automatic mix without a reload or an SSE event', async ({ page, baseURL }) => {
  const audio = Buffer.alloc(44 + 180 * 16000);
  audio.write('RIFF', 0);
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24);
  audio.writeUInt32LE(16000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write('data', 36);
  audio.writeUInt32LE(audio.length - 44, 40);
  await page.route('**/stream-url', (route) => route.fulfill({ json: { url: `${baseURL}/automatic-mix.wav` } }));
  await page.route('**/automatic-mix.wav', (route) => route.fulfill({ body: audio, contentType: 'audio/wav' }));
  await page.route('**/waveform-data', (route) => route.fulfill({ json: Array.from({ length: 200 }, (_, i) => Math.abs(Math.sin(i / 7))) }));
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Automatic mixes' } })).json();
  const { track } = await (await page.request.post(`/api/v1/tracks/${project.id}`, { data: { name: 'First stems' } })).json();
  addStem(track.id, userId, 'Drums');
  await page.route(`**/api/v1/versions/track/${track.id}`, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ json: {
      ...data,
      mixState: data.versions.length ? null : 'pending',
      versions: data.versions.map((v: { id: string }) => ({ ...v, autoMix: true })),
    } });
  });
  await page.goto(`/projects/${project.id}/tracks/${track.id}`);
  await expect(page.getByRole('status').filter({ hasText: 'Mix wird aus deinen Spuren erstellt' })).toBeVisible();
  addVersion(track.id, userId, 'ready');
  await expect(page.getByText('Automatischer Mix', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Abspielen', exact: true })).toBeEnabled();
  await expect(page.getByText('Mix wird aus deinen Spuren erstellt …', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: `.savor-logs/automatic-mix-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Abspielen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
});
