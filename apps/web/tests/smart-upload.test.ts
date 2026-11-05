import { expect, test, type Page } from '@playwright/test';
import { logIn, removeUser } from './session.js';

let userId: string;
test.beforeEach(async ({ context, baseURL }) => {
  userId = await logIn(context, baseURL!);
});
test.afterEach(() => removeUser(userId));

// A WAV whose header claims the given length; the browser reads only the header
function wav(name: string, seconds: number) {
  const byteRate = 48_000 * 2 * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + seconds * byteRate, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(48_000, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(Math.round(seconds * byteRate), 40);
  return { name, mimeType: 'audio/wav', buffer: Buffer.concat([header, Buffer.alloc(4_000)]) };
}

// The bucket and the registrations answer without S3; what the page registers is recorded. Tracks are real.
async function fakeBucket(page: Page, baseURL: string) {
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  await page.route('**/upload-url', (route) =>
    route.fulfill({ json: { uploadUrl: `${baseURL}/fake-s3/${crypto.randomUUID()}`, fileKey: `test/${crypto.randomUUID()}`, versionId: crypto.randomUUID() } }),
  );
  await page.route('**/fake-s3/**', (route) => route.fulfill({ status: 200 }));
  for (const path of ['**/api/v1/stems/track/*', '**/api/v1/files/project/*', '**/api/v1/versions/track/*']) {
    await page.route(path, (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      sent.push({ url: route.request().url(), body: route.request().postDataJSON() });
      return route.fulfill({ status: 201, json: { stem: {}, file: {}, version: {} } });
    });
  }
  return sent;
}

async function newProject(page: Page) {
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Werbespot' } })).json();
  return project.id as string;
}

test('stems of equal length become one song with a mix, sounds and sessions go to the files', async ({ page, baseURL }) => {
  const sent = await fakeBucket(page, baseURL!);
  const projectId = await newProject(page);
  await page.goto(`/projects/${projectId}`);
  // Registering waits a moment, so the detected rows can be read
  await page.route('**/api/v1/tracks/*', async (route) => {
    if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 400));
    await route.fallback();
  });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Dateien auswählen' }).click();
  await (await chooser).setFiles([
    wav('Kreise_Kick.wav', 221),
    wav('Kreise_Bass.wav', 221),
    wav('Kreise_Vox.wav', 221),
    wav('Vespa_Hupe.wav', 2),
    { name: 'Kreise.als', mimeType: 'application/octet-stream', buffer: Buffer.from('ableton') },
  ]);
  const rows = page.locator('.rows li');
  await expect(rows.first()).toContainText('3 Spuren, alle 3:41 lang');
  await expect(rows.first()).toContainText('Neuer Track · wird V1');
  await expect(rows.filter({ hasText: 'Vespa_Hupe.wav' })).toContainText('kommt in die Dateien des Projekts');

  await expect(page.locator('.toast-container')).toContainText('5 Dateien hochgeladen');
  const stems = sent.filter((s) => s.url.includes('/stems/track/'));
  expect(stems.map((s) => [s.body.name, s.body.mix])).toEqual([['Bass', true], ['Kick', true], ['Vox', true]]);
  const files = sent.filter((s) => s.url.includes('/files/project/'));
  expect(files.map((s) => s.body.originalFileName).sort()).toEqual(['Kreise.als', 'Vespa_Hupe.wav']);
  const { tracks } = await (await page.request.get(`/api/v1/tracks/project/${projectId}`)).json();
  expect(tracks.map((t: { name: string }) => t.name)).toEqual(['Kreise']);
});

test('stems can stay without a mix, and only sounds open the files', async ({ page, baseURL }) => {
  const sent = await fakeBucket(page, baseURL!);
  const projectId = await newProject(page);
  await page.goto(`/projects/${projectId}`);
  await page.route('**/fake-s3/**', async (route) => {
    await new Promise((r) => setTimeout(r, 300));
    await route.fulfill({ status: 200 });
  });
  let chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Dateien auswählen' }).click();
  await (await chooser).setFiles([wav('Audio 1.wav', 178), wav('Audio 2.wav', 178)]);
  await page.getByRole('combobox', { name: /Was aus den Spuren von „Neuer Song“ wird/ }).selectOption({ label: 'Nur Spuren, kein Mix' });
  await page.waitForURL(/\/tracks\/[0-9a-f-]{36}$/);
  expect(sent.filter((s) => s.url.includes('/stems/track/')).map((s) => s.body.mix)).toEqual([false, false]);

  await page.goto(`/projects/${projectId}`);
  chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Mix hochladen' }).click();
  await (await chooser).setFiles([wav('Vespa_Leerlauf.wav', 6), wav('Vespa_Anlassen.wav', 3)]);
  await expect(page.locator('.toast-container')).toContainText('2 Dateien in den Dateien des Projekts');
  await expect(page).toHaveURL(/view=dateien/);
});

test('trying again after a failure neither uploads nor registers a stem twice', async ({ page, baseURL }) => {
  const sent = await fakeBucket(page, baseURL!);
  const projectId = await newProject(page);
  await page.goto(`/projects/${projectId}`);
  let puts = 0;
  await page.route('**/fake-s3/**', (route) => {
    puts++;
    return route.fulfill({ status: 200 });
  });
  let failVox = true;
  await page.route('**/api/v1/stems/track/*', (route) => {
    if (failVox && route.request().postDataJSON()?.name === 'Vox') {
      failVox = false;
      return route.fulfill({ status: 500, json: { error: 'Kaputt' } });
    }
    return route.fallback();
  });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Dateien auswählen' }).click();
  await (await chooser).setFiles([wav('Kreise_Bass.wav', 200), wav('Kreise_Kick.wav', 200), wav('Kreise_Vox.wav', 200)]);
  await expect(page.locator('.rows li')).toContainText('Kaputt');
  expect(puts).toBe(3);

  await page.getByRole('button', { name: /Upload von .* erneut versuchen/ }).click();
  await expect(page.locator('.rows li')).toHaveCount(0);
  expect(puts).toBe(3);
  expect(sent.filter((s) => s.url.includes('/stems/track/')).map((s) => s.body.name)).toEqual(['Bass', 'Kick', 'Vox']);
  const { tracks } = await (await page.request.get(`/api/v1/tracks/project/${projectId}`)).json();
  expect(tracks).toHaveLength(1);
});

test('a sound can still become a version while it uploads', async ({ page, baseURL }) => {
  const sent = await fakeBucket(page, baseURL!);
  const projectId = await newProject(page);
  await page.goto(`/projects/${projectId}`);
  await page.route('**/fake-s3/**', async (route) => {
    await new Promise((r) => setTimeout(r, 600));
    await route.fulfill({ status: 200 });
  });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Dateien auswählen' }).click();
  await (await chooser).setFiles([wav('Jingle Idee.wav', 30)]);
  await page.getByRole('combobox', { name: /Jingle Idee\.wav/ }).selectOption({ label: 'Als Version eines Songs' });
  await page.waitForURL(/\/tracks\/[0-9a-f-]{36}$/);
  expect(sent.map((s) => new URL(s.url).pathname.split('/').slice(3, 5).join('/'))).toEqual(['versions/track']);
  await expect(page.getByRole('heading', { name: 'Jingle Idee', level: 1 })).toBeVisible();
});
