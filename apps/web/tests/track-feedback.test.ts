import { expect, test, type Page } from '@playwright/test';
import { addMember, addVersion, logIn, removeUser } from './session.js';

// Comments, replies, reactions, "Fertig" and approving on the real track page, with a version Lena uploaded
let userId: string;
let lena: string;
test.beforeEach(async ({ context, baseURL }) => {
  userId = await logIn(context, baseURL!, 'Robin');
});
test.afterEach(() => {
  removeUser(userId);
  removeUser(lena);
});

async function openTrack(page: Page, baseURL: string) {
  const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Nachtbus EP' } })).json();
  const { track } = await (await page.request.post(`/api/v1/tracks/${project.id}`, { data: { name: 'Letzte Bahn' } })).json();
  lena = addMember(project.id);
  addVersion(track.id, lena, 'ready');
  // The CI bucket holds no files, so the player gets a short silence
  await page.route('**/stream-url', (route) => route.fulfill({ json: { url: `${baseURL}/fake-s3/mix.wav` } }));
  await page.route('**/fake-s3/**', (route) => route.fulfill({ body: Buffer.alloc(0), contentType: 'audio/wav' }));
  await page.goto(`/projects/${project.id}/tracks/${track.id}`);
  await expect(page.locator('.version-card .status')).toHaveText('Bereit');
}

async function comment(page: Page, body: string) {
  const composer = page.getByPlaceholder('Kommentar zu V1 …');
  await composer.fill(body);
  await composer.press('Enter');
  await expect(page.locator('.toast-container')).toContainText('Kommentar gespeichert');
  await expect(page.locator('.comment', { hasText: body })).toBeVisible();
  // The first and only top-level comment; its text may change below
  return page.locator('.comment').first();
}

test('a comment gets a reply, a reaction, an edit, and is ticked off and reopened', async ({ page, baseURL }) => {
  await openTrack(page, baseURL!);
  const item = await comment(page, 'Snare zu dünn');
  await expect(page.locator('.filter').getByRole('button', { name: /^Offen \d/ })).toContainText('1');

  await item.getByRole('button', { name: 'Antworten' }).click();
  await item.getByPlaceholder('Antwort schreiben …').fill('Mache ich');
  await item.getByRole('button', { name: 'Antworten' }).last().click();
  await expect(page.locator('.comment', { hasText: 'Mache ich' })).toBeVisible();

  await item.getByRole('button', { name: 'Reagieren' }).first().click();
  await item.locator('.picker').getByRole('button', { name: '👍' }).click();
  await expect(item.locator('.reaction', { hasText: '👍' }).locator('.chip').first()).toHaveText('👍 1');

  await item.getByRole('button', { name: 'Bearbeiten' }).first().click();
  await item.locator('textarea').first().fill('Snare etwas dünn');
  await item.getByRole('button', { name: 'Speichern' }).click();
  await expect(item.locator('.text').first()).toHaveText('Snare etwas dünn');

  await item.getByRole('button', { name: 'Abhaken' }).click();
  await expect(page.getByText('Keine offenen Kommentare')).toBeVisible();
  await page.locator('.filter').getByRole('button', { name: /^Erledigte/ }).click();
  const done = page.locator('.comment', { hasText: 'Snare etwas dünn' }).first();
  await done.getByRole('button', { name: 'Wieder öffnen' }).click();
  await expect(page.locator('.filter').getByRole('button', { name: /^Offen \d/ })).toContainText('1');
});

test('"Fertig" sends the pass and shows under Rückmeldungen, approving decides and can be undone', async ({ page, baseURL }) => {
  await openTrack(page, baseURL!);
  await comment(page, 'Hall kürzer');
  await expect(page.locator('.finish-hint')).toContainText('Lena bekommt Bescheid');
  await page.getByRole('button', { name: 'Fertig mit V1 1' }).click();

  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('Eine Anmerkung geht gesammelt an Lena.')).toBeVisible();
  await sheet.getByText('Nur Anmerkungen', { exact: true }).click();
  await sheet.getByLabel('Gesamteindruck').fill('Insgesamt gut');
  await sheet.getByRole('button', { name: 'Abschicken' }).click();
  await expect(page.locator('.toast-container')).toContainText('Lena bekommt Bescheid');

  const feedback = page.locator('.feedback');
  await expect(feedback.locator('.row', { hasText: 'Du' })).toContainText('Nur Anmerkungen');
  await expect(feedback.getByText('„Insgesamt gut“')).toBeVisible();
  await expect(page.locator('.finish-hint')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Fertig mit V1', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Freigeben' }).click();
  await expect(page.locator('.version-card .status')).toHaveText('Freigegeben');
  await expect(feedback.locator('.row', { hasText: 'Du' })).toContainText('Freigegeben');
  await page.getByRole('alert').filter({ hasText: 'V1 ist freigegeben' }).getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.locator('.version-card .status')).toHaveText('Bereit');
  await expect(feedback.locator('.row', { hasText: 'Du' })).toContainText('Nur Anmerkungen');
});

test('a deleted comment waits in the trash and comes back from the toast', async ({ page, baseURL }) => {
  await openTrack(page, baseURL!);
  const item = await comment(page, 'Intro zu lang');
  await item.getByRole('button', { name: 'Löschen' }).click();
  await expect(page.locator('.comment', { hasText: 'Intro zu lang' })).toHaveCount(0);
  await page.getByRole('alert').filter({ hasText: 'Kommentar liegt im Papierkorb' }).getByRole('button', { name: 'Rückgängig' }).click();
  await expect(page.locator('.comment', { hasText: 'Intro zu lang' })).toBeVisible();
});
