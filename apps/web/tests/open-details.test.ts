import { expect, test } from '@playwright/test';
import { addVersion, logIn, removeUser } from './session.js';

const OPEN_ID = '00000000-0000-4000-8000-000000000777';
const openTrack = {
  track: { id: OPEN_ID, name: 'Nachtbus', description: null, credit: null, forkedFromId: null },
  artist: 'Fernlicht',
  people: [],
  stars: 0,
  starred: false,
  license: 'cc-by-sa',
  credit: '„Nachtbus“ von Fernlicht · CC BY-SA 4.0',
  coverUrl: null,
  version: { duration: 40 },
  streamUrl: '/nothing.mp3',
  waveformUrl: null,
  stems: [],
  remixes: { count: 0, open: [] },
};

test('a rejected contact address in a report reads as text, not as an object', async ({ page }) => {
  await page.route(`**/api/v1/open/${OPEN_ID}`, (route) => route.fulfill({ json: openTrack }));
  // What the API's validator answers: the error is an object
  await page.route(`**/api/v1/open/${OPEN_ID}/report`, (route) =>
    route.fulfill({ status: 400, json: { success: false, error: { name: 'ZodError', message: '[]' } } }),
  );
  await page.goto(`/offen/${OPEN_ID}`);
  await page.getByRole('button', { name: 'Melden' }).click();
  const dialog = page.getByRole('dialog', { name: 'Seite melden' });
  await dialog.locator('textarea').fill('Da ist ein Sample aus meinem Song drin.');
  await dialog.locator('input[type=email]').fill('kein-mail');
  await dialog.getByRole('button', { name: 'Melden' }).click();
  const toasts = page.locator('.toast-container');
  await expect(toasts).toContainText('Prüf bitte deine Mail-Adresse oder lass das Feld leer.');
  await expect(toasts).not.toContainText('[object Object]');
});

test('copying the attribution says so in German', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/offen/beispiel');
  await page.locator('.card', { hasText: 'So nennst du die Quelle' }).getByRole('button', { name: 'Kopieren' }).click();
  await expect(page.locator('.toast-container')).toContainText('Quellenangabe kopiert');
});

test.describe('signed in', () => {
  let userId: string;
  test.beforeEach(async ({ context, baseURL }) => {
    userId = await logIn(context, baseURL!, 'Robin');
  });
  test.afterEach(() => removeUser(userId));

  test('closing an open page confirms that it is closed, not withdrawn', async ({ page }) => {
    const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Nachtbus EP' } })).json();
    const { track } = await (await page.request.post(`/api/v1/tracks/${project.id}`, { data: { name: 'Nachtbus' } })).json();
    const versionId = addVersion(track.id, userId, 'ready');
    const state = (openedAt: string | null) => ({
      open: {
        license: openedAt ? 'cc-by-sa' : null,
        openedAt,
        requestedById: openedAt ? userId : null,
        versionId,
        allowedLicenses: ['cc-by-sa', 'cc-by', 'cc0'],
        contributors: [{ id: userId, name: 'Robin', avatarUrl: null, stemCount: 0, consented: !!openedAt }],
      },
    });
    await page.route(`**/api/v1/tracks/${track.id}/open`, (route) =>
      route.fulfill({ json: state(route.request().method() === 'DELETE' ? null : new Date().toISOString()) }),
    );
    await page.goto(`/projects/${project.id}/tracks/${track.id}`);
    await page.locator('.chip.open').click();
    await page.getByRole('button', { name: 'Seite schließen' }).click();
    await page.getByRole('dialog', { name: 'Bist du sicher?' }).getByRole('button', { name: 'Ja, weiter' }).click();
    const toasts = page.locator('.toast-container');
    await expect(toasts).toContainText('Geschlossen');
    await expect(toasts).not.toContainText('Zurückgezogen');
  });

  test('a fresh remix explains how it gets a version instead of promising a mix', async ({ page }) => {
    const { project } = await (await page.request.post('/api/v1/projects', { data: { name: 'Remixe' } })).json();
    const { track } = await (await page.request.post(`/api/v1/tracks/${project.id}`, { data: { name: 'Nachtbus (Remix)' } })).json();
    // As forkTrack leaves it: credit and license on the track, the stems taken over from the original
    await page.route(`**/api/v1/tracks/project/${project.id}`, async (route) => {
      const body = await (await route.fetch()).json();
      for (const t of body.tracks) Object.assign(t, { forkedFromId: OPEN_ID, credit: '„Nachtbus“ von Fernlicht · CC BY-SA 4.0', license: 'cc-by-sa' });
      await route.fulfill({ json: body });
    });
    const stem = (name: string) => ({ id: crypto.randomUUID(), name, originalFileName: `${name}.wav`, mimeType: 'audio/wav', fileSize: 7, createdAt: new Date().toISOString(), createdById: userId, forked: true });
    await page.route(`**/api/v1/stems/track/${track.id}`, (route) => route.fulfill({ json: { stems: [stem('Bass'), stem('Drums')], guestNotes: [] } }));
    await page.goto(`/projects/${project.id}/tracks/${track.id}`);
    const empty = page.getByText('Die 2 Spuren des Originals liegen bereit.');
    await expect(empty).toBeVisible();
    await expect(page.getByText('entsteht automatisch eine abspielbare Version')).toHaveCount(0);
  });

  test('the placeholder of a new project name fits the field', async ({ page }) => {
    await page.goto('/projects/new');
    const input = page.getByPlaceholder(/Debütalbum/);
    await expect(input).toBeVisible();
    const room = await input.evaluate((el: HTMLInputElement) => {
      const style = getComputedStyle(el);
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const inner = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      return inner - ctx.measureText(el.placeholder).width;
    });
    expect(room).toBeGreaterThan(0);
  });
});
