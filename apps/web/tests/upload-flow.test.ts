import { expect as baseExpect, test, type Page } from '@playwright/test';
import { addVersion, finishProcessing, logIn, removeUser } from './session.js';

const expect = baseExpect.configure({ timeout: 15_000 });
test.setTimeout(60_000);
test.use({ serviceWorkers: 'block' });
let userId: string;
test.beforeEach(async ({ context, baseURL }) => { userId = await logIn(context, baseURL!); });
test.afterEach(() => removeUser(userId));
const wav = (name: string) => ({ name, mimeType: 'audio/wav', buffer: Buffer.from('RIFF0000WAVE') });
async function track(page: Page) {
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Nachtbus EP' } })).json();
  const { track } = await (await page.request.post(`/api/v1/tracks/${project.id}`, { data: { name: 'Letzte Bahn' } })).json();
  return { projectId: project.id as string, trackId: track.id as string };
}
async function audio(page: Page, baseURL: string) {
  await page.route('**/stream-url', (r) => r.fulfill({ json: { url: `${baseURL}/demo/nachtbus-v1.mp3` } }));
  await page.route('**/waveform-data', (r) => r.fulfill({ json: [0.1, 0.4, 0.8, 0.5, 0.2] }));
}
async function uploads(page: Page, baseURL: string, registered: string[]) {
  await page.route('**/upload-url', (r) => r.fulfill({ json: { uploadUrl: `${baseURL}/fake-s3/mix.wav`, fileKey: 'test/mix.wav', versionId: crypto.randomUUID() } }));
  await page.route('**/fake-s3/**', (r) => r.fulfill({ status: 200 }));
  await page.route('**/api/v1/versions/track/*', async (r) => {
    if (r.request().method() !== 'POST') return r.fallback();
    const id = r.request().url().split('/').at(-1)!;
    const { versions } = await (await page.request.get(`/api/v1/versions/track/${id}`)).json();
    const number = Math.max(0, ...versions.map((v: { versionNumber: number }) => v.versionNumber)) + 1;
    const versionId = addVersion(id, userId, 'processing', number);
    registered.push(id);
    await r.fulfill({ json: { version: { id: versionId } } });
  });
}

test('matching mixes append in order without duplicating the track', async ({ page, baseURL }) => {
  const { projectId, trackId } = await track(page);
  addVersion(trackId, userId, 'ready');
  const registered: string[] = [];
  await uploads(page, baseURL!, registered);
  await page.goto(`/projects/${projectId}`);
  await page.locator('input[type=file]').setInputFiles([wav('Letzte Bahn – Mix 3.wav'), wav('Letzte Bahn – Mix 2.wav')]);
  await expect(page.locator('.toast-container')).toContainText('2 Dateien hochgeladen');
  expect(registered).toEqual([trackId, trackId]);
  const { tracks } = await (await page.request.get(`/api/v1/tracks/project/${projectId}`)).json();
  expect(tracks).toHaveLength(1);
  const { versions } = await (await page.request.get(`/api/v1/versions/track/${trackId}`)).json();
  expect(versions.map((v: { versionNumber: number }) => v.versionNumber)).toEqual([3, 2, 1]);
});

for (const switchBack of [false, true]) {
test(`the destination can ${switchBack ? 'switch back to the existing track' : 'change to a new track'} during transfer`, async ({ page, baseURL }, testInfo) => {
  const { projectId, trackId } = await track(page);
  addVersion(trackId, userId, 'ready');
  const registered: string[] = [];
  await uploads(page, baseURL!, registered);
  let transfers = 0;
  let finishTransfer: (() => Promise<void>) | undefined;
  await page.route('**/fake-s3/**', (r) => {
    if (++transfers === 1) finishTransfer = () => r.fulfill({ status: 200 });
    else return r.fulfill({ status: 200 });
  });
  await page.goto(`/projects/${projectId}`);
  await page.locator('input[type=file]').setInputFiles(wav('Letzte Bahn – Mix 4.wav'));
  await expect(page.locator('.rows')).toContainText('wird V2 von „Letzte Bahn“');
  await expect.poll(() => transfers).toBe(1);
  await page.screenshot({ path: `/tmp/musichub-upload-review/${testInfo.project.name}-target.png`, fullPage: true });
  await page.getByRole('button', { name: 'Stattdessen neuer Track', exact: true }).click();
  if (switchBack) await page.getByRole('button', { name: 'Stattdessen als neue Version anhängen', exact: true }).click();
  await finishTransfer!();
  await page.waitForURL(/\/tracks\/[\w-]+$/);
  expect(registered).toHaveLength(1);
  if (switchBack) expect(registered[0]).toBe(trackId);
  else expect(registered[0]).not.toBe(trackId);
  const { versions } = await (await page.request.get(`/api/v1/versions/track/${trackId}`)).json();
  expect(versions).toHaveLength(switchBack ? 2 : 1);
  const { tracks } = await (await page.request.get(`/api/v1/tracks/project/${projectId}`)).json();
  expect(tracks).toHaveLength(switchBack ? 1 : 2);
  expect(transfers).toBe(1);
});
}

test('a queued new-track choice can switch back during its transfer without retransferring', async ({ page, baseURL }) => {
  const { projectId, trackId } = await track(page);
  addVersion(trackId, userId, 'ready');
  const registered: string[] = [];
  await uploads(page, baseURL!, registered);
  const transfers: (() => Promise<void>)[] = [];
  await page.route('**/fake-s3/**', (r) => { transfers.push(() => r.fulfill({ status: 200 })); });
  await page.goto(`/projects/${projectId}`);
  await page.locator('input[type=file]').setInputFiles([wav('Letzte Bahn – Mix 2.wav'), wav('Letzte Bahn – Mix 3.wav')]);
  await expect.poll(() => transfers.length).toBe(1);
  const second = page.locator('.rows .row').nth(1);
  await second.getByRole('button', { name: 'Stattdessen neuer Track', exact: true }).click();
  await transfers[0]();
  await expect.poll(() => transfers.length).toBe(2);
  await second.getByRole('button', { name: 'Stattdessen als neue Version anhängen', exact: true }).click();
  await transfers[1]();
  await expect(page.locator('.toast-container')).toContainText('2 Dateien hochgeladen');
  expect(registered).toEqual([trackId, trackId]);
  expect(transfers).toHaveLength(2);
  expect((await (await page.request.get(`/api/v1/tracks/project/${projectId}`)).json()).tracks).toHaveLength(1);
});

test('cancelling active and queued project uploads creates neither tracks nor versions', async ({ page, baseURL }) => {
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Empty project' } })).json();
  const registered: string[] = [];
  await uploads(page, baseURL!, registered);
  let transfers = 0;
  await page.route('**/fake-s3/**', () => { transfers++; });
  await page.goto(`/projects/${project.id}`);
  await page.locator('input[type=file]').setInputFiles([wav('Nachtbus.wav'), wav('Zugabe.wav')]);
  await expect.poll(() => transfers).toBe(1);
  await page.getByRole('button', { name: 'Upload von Zugabe.wav abbrechen', exact: true }).click();
  await page.getByRole('button', { name: 'Upload von Nachtbus.wav abbrechen', exact: true }).click();
  await expect(page.locator('.rows .state')).toHaveText(['abgebrochen', 'abgebrochen']);
  await expect(page.getByRole('button', { name: 'Dateien auswählen', exact: true })).toBeVisible();
  expect(registered).toHaveLength(0);
  expect(transfers).toBe(1);
  expect((await (await page.request.get(`/api/v1/tracks/project/${project.id}`)).json()).tracks).toHaveLength(0);
});

test('ambiguous track names do not silently choose a destination', async ({ page, baseURL }) => {
  const { projectId, trackId } = await track(page);
  await page.request.post(`/api/v1/tracks/${projectId}`, { data: { name: 'Letzte Bahn' } });
  const registered: string[] = [];
  await uploads(page, baseURL!, registered);
  await page.goto(`/projects/${projectId}`);
  await page.locator('input[type=file]').setInputFiles(wav('Letzte Bahn – Mix 4.wav'));
  await page.waitForURL(/\/tracks\/[\w-]+$/);
  expect(registered).toHaveLength(1);
  expect(registered[0]).not.toBe(trackId);
  const { tracks } = await (await page.request.get(`/api/v1/tracks/project/${projectId}`)).json();
  expect(tracks).toHaveLength(3);
});

test('the landing demo offers A/B without sending API writes', async ({ page, isMobile }) => {
  const requests: string[] = [];
  await page.route('**/api/v1/**', (route) => {
    if (route.request().method() !== 'GET') requests.push(route.request().url());
    return route.continue();
  });
  await page.goto('/');
  if (isMobile) await page.getByRole('button', { name: 'Ausprobieren', exact: true }).click();
  const demo = page.frameLocator('iframe[name="musichub-demo"]');
  const summary = demo.getByRole('region', { name: 'Neue Version vergleichen' });
  await expect(summary).toContainText('V4 ist da');
  await summary.getByRole('button', { name: /↔.*vergleichen/ }).click();
  const ab = demo.getByRole('region', { name: 'A/B-Vergleich' });
  await ab.getByRole('button', { name: 'Abspielen', exact: true }).click();
  await expect(ab.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await ab.locator('.choices button').first().click();
  await expect(ab.locator('.time')).toContainText('Du hörst V2');
  await expect(demo.getByText('In der Demo nicht verfügbar', { exact: true })).toHaveCount(0);
  expect(requests).toHaveLength(0);
});

test('upload names the file, destination, bytes and queue before processing', async ({ page, baseURL }, testInfo) => {
  const { projectId, trackId } = await track(page);
  addVersion(trackId, userId, 'ready');
  await audio(page, baseURL!);
  await page.route('**/upload-url', (r) => r.fulfill({ json: { uploadUrl: `${baseURL}/fake-s3/mix.wav`, fileKey: 'test/mix.wav' } }));
  await page.route('**/fake-s3/**', () => {});
  await page.goto(`/projects/${projectId}/tracks/${trackId}`);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Neue Version', exact: true }).click();
  await (await chooser).setFiles([wav('Letzte Bahn – Mix 3.wav'), wav('Letzte Bahn – Mix 2.wav')]);
  const upload = page.locator('.upload-section');
  await expect(upload).toContainText('Datei 1 von 2');
  await expect(upload.locator('.upload-file')).toContainText(['Mix 2.wav', 'Mix 3.wav']);
  await expect(upload).toContainText('wird V2');
  await expect(upload).toContainText('wird V3');
  await expect(upload).toContainText(/von .* MB/);
  await expect(page.locator('.cancel-version')).toHaveText('Abbrechen');
  await page.screenshot({ path: `/tmp/musichub-upload-review/${testInfo.project.name}-upload.png`, fullPage: true });
  await page.getByRole('button', { name: 'Upload abbrechen' }).click();
  await expect(upload).toHaveCount(0);
});

test('new version offers A/B at the same position, resolves old points and remembers dismissal', async ({ page, baseURL }, testInfo) => {
  const { projectId, trackId } = await track(page);
  const first = addVersion(trackId, userId, 'ready');
  addVersion(trackId, userId, 'ready', 2);
  await page.request.post(`/api/v1/comments/version/${first}`, { data: { body: 'Bass im Refrain prüfen', timestampSeconds: 8 } });
  await audio(page, baseURL!);
  await page.route(`**/api/v1/versions/track/${trackId}`, async (r) => {
    const res = await r.fetch();
    const body = await res.json();
    body.versions.forEach((v: { integratedLufs: number; versionNumber: number }) => { v.integratedLufs = v.versionNumber === 1 ? -18 : -15; });
    await r.fulfill({ json: body });
  });
  await page.goto(`/projects/${projectId}/tracks/${trackId}`);
  const summary = page.getByRole('region', { name: 'Neue Version vergleichen' });
  await expect(summary).toContainText('V2 ist da');
  await expect(summary).toContainText('1 offener Punkt');
  await expect(summary).toContainText('-18,0 → -15,0 LUFS');
  await page.screenshot({ path: `/tmp/musichub-upload-review/${testInfo.project.name}-summary.png`, fullPage: true });
  await summary.getByRole('button', { name: 'V1 ↔ V2 vergleichen' }).click();
  const ab = page.getByRole('region', { name: 'A/B-Vergleich' });
  await expect(ab.getByRole('checkbox', { name: /Gleich laut/ })).toBeChecked();
  await expect(ab.getByRole('button', { name: /Abspielen/ })).toBeEnabled();
  await expect(ab.locator('.wave i').first()).toBeVisible();
  await ab.getByRole('slider').fill('5');
  await ab.getByRole('heading', { name: 'V1 ↔ V2', exact: true }).click();
  await page.keyboard.press('1');
  await expect(ab).toContainText('Du hörst V1 · 0:05');
  await page.keyboard.press('2');
  await expect(ab).toContainText('Du hörst V2 · 0:05');
  await ab.getByRole('button', { name: 'Abspielen', exact: true }).click();
  await expect(ab.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect.poll(async () => ab.locator('.time').textContent()).not.toContain('0:05 /');
  await page.keyboard.press('1');
  await expect(ab).toContainText('Du hörst V1');
  expect(Number(await ab.getByRole('slider').inputValue())).toBeGreaterThan(5);
  await page.keyboard.press('2');
  await expect(ab.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await ab.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.screenshot({ path: `/tmp/musichub-upload-review/${testInfo.project.name}-ab.png`, fullPage: true });
  await ab.getByRole('button', { name: 'Gelöst', exact: true }).click();
  await expect(ab).not.toContainText('Bass im Refrain prüfen');
  await ab.getByRole('button', { name: 'Zurück' }).click();
  await summary.getByRole('button', { name: 'Ausblenden' }).click();
  await page.reload();
  await expect(page.locator('.version-card')).toBeVisible();
  await expect(summary).toHaveCount(0);
  addVersion(trackId, userId, 'ready', 3);
  await page.reload();
  await expect(summary).toContainText('V3 ist da');
});

test('A/B keeps selections and seeks made before the streams arrive', async ({ page, baseURL }) => {
  const { projectId, trackId } = await track(page);
  addVersion(trackId, userId, 'ready');
  addVersion(trackId, userId, 'ready', 2);
  await audio(page, baseURL!);
  await page.goto(`/projects/${projectId}/tracks/${trackId}`);
  const summary = page.getByRole('region', { name: 'Neue Version vergleichen' });
  await expect(summary).toBeVisible();
  const streams: (() => Promise<void>)[] = [];
  await page.route('**/stream-url', (r) => { streams.push(() => r.fulfill({ json: { url: `${baseURL}/demo/nachtbus-v1.mp3` } })); });
  await summary.getByRole('button', { name: 'V1 ↔ V2 vergleichen' }).click();
  const ab = page.getByRole('region', { name: 'A/B-Vergleich' });
  await expect.poll(() => streams.length).toBe(2);
  await ab.locator('.choices button').first().click();
  await ab.getByRole('slider').fill('17');
  await expect(ab.getByRole('button', { name: 'Abspielen', exact: true })).toBeDisabled();
  await Promise.all(streams.map((finish) => finish()));
  await ab.getByRole('button', { name: 'Abspielen', exact: true }).click();
  await expect(ab.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect.poll(async () => Number(await ab.getByRole('slider').inputValue())).toBeGreaterThan(17.2);
  await expect(ab).toContainText('Du hörst V1');
});

test('processing completion celebrates readiness, unreadable version has recovery without a dead player', async ({ page, baseURL }, testInfo) => {
  const { projectId, trackId } = await track(page);
  const id = addVersion(trackId, userId, 'processing');
  await audio(page, baseURL!);
  await page.goto(`/projects/${projectId}/tracks/${trackId}`);
  await expect(page.locator('.version-card')).toContainText('Wird verarbeitet');
  await expect(async () => {
    finishProcessing(trackId, id);
    await expect(page.locator('.toast-container')).toContainText('V1 ist fertig', { timeout: 1000 });
  }).toPass();
  await page.route(`**/api/v1/versions/track/${trackId}`, async (r) => {
    const body = await (await r.fetch()).json();
    body.versions[0].duration = null;
    await r.fulfill({ json: body });
  });
  await page.reload();
  const card = page.locator('.version-card');
  await expect(card.getByRole('alert')).toContainText('Diese Datei lässt sich nicht verarbeiten');
  await expect(card.getByRole('button', { name: 'Neu hochladen' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Version in den Papierkorb', exact: true })).toBeVisible();
  await expect(card.locator('.player')).toHaveCount(0);
  await expect(page.locator('section.invite')).toHaveCount(0);
  await page.screenshot({ path: `/tmp/musichub-upload-review/${testInfo.project.name}-unreadable.png`, fullPage: true });
});


test('registration locks cancellation and processing never offers approval while the new player loads', async ({ page, baseURL }) => {
  const { projectId, trackId } = await track(page);
  addVersion(trackId, userId, 'ready');
  await audio(page, baseURL!);
  let registeredId = '';
  let finishStream: (() => Promise<void>) | undefined;
  await page.route('**/stream-url', (r) => {
    if (registeredId && r.request().url().includes(registeredId)) finishStream = () => r.fulfill({ json: { url: `${baseURL}/demo/nachtbus-v1.mp3` } });
    else return r.fallback();
  });
  await page.route('**/upload-url', (r) => r.fulfill({ json: { uploadUrl: `${baseURL}/fake-s3/mix.wav`, fileKey: 'test/mix.wav' } }));
  await page.route('**/fake-s3/**', (r) => r.fulfill({ status: 200 }));
  let finishSaving: (() => Promise<void>) | undefined;
  await page.route(`**/api/v1/versions/track/${trackId}`, (r) => {
    if (r.request().method() === 'POST') finishSaving = async () => {
      registeredId = addVersion(trackId, userId, 'processing', 2);
      await r.fulfill({ json: { version: { id: registeredId } } });
    };
    else return r.fallback();
  });
  await page.goto(`/projects/${projectId}/tracks/${trackId}`);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Neue Version', exact: true }).click();
  await (await chooser).setFiles(wav('Mix 1.wav'));
  await expect(page.locator('.cancel-version')).toBeDisabled();
  await expect(page.locator('.cancel-version')).toHaveText('Wird gespeichert');
  await expect.poll(() => typeof finishSaving).toBe('function');
  await finishSaving!();
  await expect(page.locator('.upload-section')).toHaveCount(0);
  await expect(page.locator('.toast-container')).not.toContainText('Upload abgebrochen');
  await expect.poll(() => typeof finishStream).toBe('function');
  await expect(page.locator('.version-card').getByRole('button', { name: 'Freigeben', exact: true })).toHaveCount(0);
  await finishStream!();
  await expect(page.locator('.version-card')).toContainText('Wird verarbeitet');
});
