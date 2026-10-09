import { expect, test, type Page } from '@playwright/test';

// Console errors fail the test
let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
});
test.afterEach(() => expect(errors).toEqual([]));

// The list as the API returns it, independent of what the test database holds
const openList = (page: Page, tracks: object[]) =>
  page.route('**/api/v1/open', (route) => route.fulfill({ json: { tracks } }));

test('the intro says what lies here and the header offers an account', async ({ page }) => {
  await openList(page, []);
  await page.goto('/offen');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Offene Musik');
  await expect(page.locator('.intro p')).toContainText('zum Remixen freigegeben');
  const nav = page.locator('nav.nav');
  await expect(nav.getByRole('link', { name: 'Konto anlegen', exact: true })).toHaveAttribute('href', '/register');
  await expect(nav.getByRole('link', { name: 'Einloggen' })).toBeVisible();
});

test('three steps explain how a track becomes open', async ({ page }) => {
  await openList(page, []);
  await page.goto('/offen');
  const steps = page.locator('.steps li b');
  await expect(steps).toHaveText(['Track freigeben', 'Hier erscheinen', 'Remixe entstehen']);
});

test('while nothing is open, Nachtbus is a marked example with a demo page', async ({ page }) => {
  await openList(page, []);
  await page.goto('/offen');
  const item = page.locator('.list li');
  await expect(item).toHaveCount(1);
  await expect(item.locator('.tag')).toHaveText('Beispiel');

  // The example page answers from the demo data, nothing goes to the API
  const asked: string[] = [];
  page.on('request', (r) => r.url().includes('/api/v1/open/') && asked.push(r.url()));
  await item.getByRole('link').click();
  await expect(page).toHaveURL(/\/offen\/beispiel$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nachtbus');
  await expect(page.locator('.example')).toContainText('Beispiel mit erfundenen Daten');
  await expect(page.locator('.list li')).toHaveCount(12);
  expect(asked).toEqual([]);
});

test('real open tracks replace the example', async ({ page }) => {
  await openList(page, [
    { id: '00000000-0000-4000-8000-000000000999', name: 'Echt', artist: 'Jemand', coverUrl: null, license: 'cc0', duration: 60, stemCount: 1, remixCount: 0 },
  ]);
  await page.goto('/offen');
  await expect(page.locator('.list li')).toHaveText(/Echt/);
  await expect(page.locator('.tag')).toHaveCount(0);
});

test('the page ends with a clear next step', async ({ page }) => {
  await openList(page, []);
  await page.goto('/offen');
  const cta = page.locator('.cta');
  await expect(cta.getByRole('link', { name: 'Konto anlegen und Track freigeben' })).toHaveAttribute('href', '/register');
  await expect(cta.getByRole('link', { name: 'Schon dabei? Einloggen' })).toHaveAttribute('href', '/login?next=%2Foffen');
});
