import { expect, test, type Page } from '@playwright/test';
import { appFeedbackOf, logIn, removeUser } from './session.js';

// Feedback on the app (README, „Feedback zur App“): the bug button behind test mode and the entry in the account menu
let userId: string;
let errors: string[] = [];
test.beforeEach(async ({ context, baseURL, page }) => {
  userId = await logIn(context, baseURL!, 'Lena');
  // Console errors fail the test, CSP violations of the screenshot included
  errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
});
test.afterEach(() => {
  removeUser(userId);
  expect(errors).toEqual([]);
});

const bug = (page: Page) => page.getByRole('button', { name: 'Fehler melden' });
const testMode = (page: Page) => page.getByRole('checkbox', { name: 'Testmodus' });

test('test mode starts off and switches the bug button on this device', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(testMode(page)).not.toBeChecked();
  await expect(bug(page)).toBeHidden();

  await testMode(page).check();
  await expect(bug(page)).toBeVisible();
  await page.reload();
  await expect(testMode(page)).toBeChecked();
  await expect(bug(page)).toBeVisible();

  await testMode(page).uncheck();
  await expect(bug(page)).toBeHidden();
  await page.reload();
  await expect(bug(page)).toBeHidden();
});

test('the bug button sends a marked screenshot of the page', async ({ page }) => {
  await page.goto('/dashboard');
  await testMode(page).check();
  await bug(page).click();

  const panel = page.getByRole('dialog', { name: 'Fehler melden' });
  await expect(panel.getByRole('img', { name: 'Screenshot' })).toBeVisible();
  await expect(bug(page)).toBeHidden();
  await expect(panel).toContainText('erscheinen öffentlich auf GitHub');

  await panel.getByRole('button', { name: 'Stelle markieren' }).click();
  const box = (await page.locator('.mark img').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4, { steps: 5 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Fertig' }).click();

  await panel.getByRole('textbox').fill('Speichern hängt');
  await panel.getByRole('button', { name: 'Senden' }).click();
  await expect(page.getByText('Danke! Wir melden uns per Mail.')).toBeVisible();
  await expect(bug(page)).toBeVisible();

  const [report] = appFeedbackOf(userId);
  expect(report).toMatchObject({ kind: 'bug', message: 'Speichern hängt', screenshot: [0xff, 0xd8, 0xff] });
  expect(report!.context).toMatchObject({ platform: 'web', page: '/dashboard', locale: 'de' });
});

test('the account menu takes ideas without a screenshot, in English too', async ({ page, context, baseURL, isMobile }) => {
  await context.addCookies([{ name: 'locale', value: 'en', url: baseURL! }]);
  await page.goto('/dashboard');
  if (isMobile) await page.getByRole('button', { name: 'Open menu' }).click();
  await page.locator('aside.sidebar button.user').click();
  await page.locator('aside.sidebar .menu').getByRole('button', { name: 'Feedback on the app' }).click();

  const panel = page.getByRole('dialog', { name: 'Feedback on the app' });
  await expect(panel.getByRole('img')).toHaveCount(0);
  await panel.getByRole('textbox').fill('A darker waveform would be nice');
  await panel.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText("Thanks! We'll get back to you by email.")).toBeVisible();

  expect(appFeedbackOf(userId)).toMatchObject([{ kind: 'idea', screenshot: null, context: { locale: 'en' } }]);
});

test('the bug button keeps its place after moving and reloading', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('feedback-button') !== null) return;
    localStorage.setItem('test-mode', 'true');
    localStorage.setItem('feedback-button', JSON.stringify({ x: 80, y: 140 }));
  });
  await page.goto('/dashboard');
  await expect(bug(page)).toBeVisible();
  const box = (await bug(page).boundingBox())!;
  expect(box.x).toBe(80);
  expect(box.y).toBe(140);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  await page.reload();
  await expect(bug(page)).toBeVisible();
  const moved = (await bug(page).boundingBox())!;
  expect(moved.x).toBeCloseTo(110, 0);
  expect(moved.y).toBeCloseTo(180, 0);
});
