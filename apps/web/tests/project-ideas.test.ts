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

// The bucket and the registrations answer without S3; what the page registers is recorded
async function fakeBucket(page: Page, baseURL: string) {
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  await page.route('**/upload-url', (route) =>
    route.fulfill({ json: { uploadUrl: `${baseURL}/fake-s3/${crypto.randomUUID()}`, fileKey: `test/${crypto.randomUUID()}`, versionId: crypto.randomUUID() } }),
  );
  await page.route('**/fake-s3/**', (route) => route.fulfill({ status: 200 }));
  for (const path of ['**/api/v1/stems/track/*', '**/api/v1/versions/track/*']) {
    await page.route(path, (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      sent.push({ url: route.request().url(), body: route.request().postDataJSON() });
      return route.fulfill({ status: 201, json: { stem: {}, version: {} } });
    });
  }
  return sent;
}

const memberCount = async (page: Page, projectId: string) =>
  ((await (await page.request.get(`/api/v1/projects/${projectId}/members`)).json()) as { members: unknown[] }).members.length;

test('contributors: roles explain themselves, open invitations show, removing can be undone', async ({ page }) => {
  test.setTimeout(40_000);
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Nachtbus EP' } })).json();
  const email = `test-${crypto.randomUUID()}@example.com`;
  await page.request.post(`/api/v1/projects/${project.id}/members`, { data: { email, roles: ['mixing_engineer'] } });
  await page.goto(`/projects/${project.id}/settings`);

  // The owner comes first, the invitation is marked as open
  await expect(page.locator('.member-row').first()).toContainText('Besitzer');
  const row = page.locator('.member-row').filter({ hasText: email });
  await expect(row).toContainText('Einladung offen');
  // Every role says what it may do
  await expect(page.locator('.invite-form').getByText('Rollen · mehrere möglich')).toBeVisible();
  await expect(page.locator('.invite-form').getByRole('button', { name: 'Label' })).toHaveAccessibleDescription('gibt frei, ohne Download');

  // Removing waits for the undo toast
  await page.getByRole('button', { name: `${email} bearbeiten` }).click();
  await page.getByRole('button', { name: 'Aus dem Projekt entfernen' }).click();
  await expect(row).toHaveCount(0);
  await page.locator('.toast-container').getByRole('button', { name: 'Rückgängig' }).click();
  await expect(row).toBeVisible();
  expect(await memberCount(page, project.id)).toBe(2);

  // Without undo it is gone once the toast is over
  await page.getByRole('button', { name: `${email} bearbeiten` }).click();
  await page.getByRole('button', { name: 'Aus dem Projekt entfernen' }).click();
  await expect.poll(() => memberCount(page, project.id), { timeout: 12_000 }).toBe(1);
});

test('leaving the settings removes at once what waits for undo', async ({ page }) => {
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Nachtbus EP' } })).json();
  const email = `test-${crypto.randomUUID()}@example.com`;
  await page.request.post(`/api/v1/projects/${project.id}/members`, { data: { email, roles: ['artist'] } });
  await page.goto(`/projects/${project.id}/settings`);
  await page.getByRole('button', { name: `${email} bearbeiten` }).click();
  await page.getByRole('button', { name: 'Aus dem Projekt entfernen' }).click();
  await page.goto(`/projects/${project.id}`);
  await expect.poll(() => memberCount(page, project.id), { timeout: 3000 }).toBe(1);
});

test('an empty track offers one drop field and files the mix as V1 of this track', async ({ page, baseURL }) => {
  const sent = await fakeBucket(page, baseURL!);
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Nachtbus EP' } })).json();
  const { track } = await (await page.request.post(`/api/v1/tracks/${project.id}`, { data: { name: 'Letzte Bahn' } })).json();
  await page.goto(`/projects/${project.id}/tracks/${track.id}`);

  await expect(page.getByRole('heading', { name: 'Leg deinen Mix oder die Spuren hier ab' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Neue Version', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Spuren hochladen' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /0 Versionen/ })).toHaveCount(0);

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Dateien auswählen' }).click();
  // Named after another song: on this track it still goes here
  await (await chooser).setFiles(wav('Ganz anderer Name.wav', 180));
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].url).toContain(`/versions/track/${track.id}`);
  await expect(page).toHaveURL(`/projects/${project.id}/tracks/${track.id}`);
});

test('stems dropped on an empty track become its stems with a mix', async ({ page, baseURL }) => {
  const sent = await fakeBucket(page, baseURL!);
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Nachtbus EP' } })).json();
  const { track } = await (await page.request.post(`/api/v1/tracks/${project.id}`, { data: { name: 'Kaltfront' } })).json();
  await page.goto(`/projects/${project.id}/tracks/${track.id}`);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Dateien auswählen' }).click();
  await (await chooser).setFiles([wav('Drums.wav', 90), wav('Bass.wav', 90), wav('Vox.wav', 90)]);
  await expect.poll(() => sent.length).toBe(3);
  expect(sent.every((s) => s.url.endsWith(`/stems/track/${track.id}`) && s.body.mix === true)).toBe(true);
});
