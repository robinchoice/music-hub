import { expect, test, type Route } from '@playwright/test';
import { addLoginCode, logIn, removeEmail, removeUser, sessionClientOf } from './session';

test('the email code logs in within this browser and preserves next', async ({ page, context, baseURL }) => {
  const email = `test-${crypto.randomUUID()}@example.com`;
  const id = await logIn(context, baseURL!, 'Lena', email);
  try {
    addLoginCode(id);
    await context.clearCookies();
    let pendingCheck: Route | undefined;
    await page.route('**/api/v1/auth/me', (route) => {
      if (pendingCheck) return route.continue();
      pendingCheck = route;
    });
    await page.route('**/api/v1/auth/magic-link', (route) => route.fulfill({ json: { message: 'Magic link sent' } }));
    await page.goto('/login?tab=magic&next=/account');
    await page.getByLabel('E-Mail', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Login-Link senden' }).click();
    await page.screenshot({ path: `/tmp/musichub-login-code-${test.info().project.name}.png`, fullPage: true });
    await page.getByLabel('Login-Code').fill('123456');
    await page.getByRole('button', { name: 'Code einlösen' }).click();
    await expect(page).toHaveURL(`${baseURL}/account`);
    await expect.poll(() => !!pendingCheck).toBe(true);
    await page.unroute('**/api/v1/auth/me');
    await pendingCheck!.fulfill({ json: { user: null } });
    await expect(page.getByRole('heading', { name: 'Konto', exact: true })).toBeVisible();
    expect((await context.cookies()).find((cookie) => cookie.name === 'session')?.httpOnly).toBe(true);
  } finally { removeUser(id); removeEmail(email); }
});

for (const mode of ['button', 'autofill']) {
test(`a discoverable passkey can be added, used by ${mode} and removed`, async ({ page, context, baseURL }) => {
  if (mode === 'button') await page.addInitScript(() => { PublicKeyCredential.isConditionalMediationAvailable = async () => false; });
  const id = await logIn(context, baseURL!);
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  try {
    await page.goto('/account');
    await page.getByRole('button', { name: 'Passkey anlegen' }).click();
    const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Passkeys', exact: true }) });
    await expect(section.getByRole('button', { name: 'Entfernen', exact: true })).toBeVisible();
    await page.screenshot({ path: `/tmp/musichub-passkey-account-${test.info().project.name}.png`, fullPage: true });
    const credentials = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
    expect(credentials.credentials).toHaveLength(1);
    expect(credentials.credentials[0].rpId).toBe('localhost');
    await context.clearCookies();
    await page.goto('/login?next=/account');
    await page.screenshot({ path: `/tmp/musichub-passkey-login-${test.info().project.name}.png`, fullPage: true });
    if (mode === 'button') {
      await page.getByRole('button', { name: 'Mit Passkey einloggen' }).click();
    }
    await expect(page).toHaveURL(`${baseURL}/account`);
    expect(sessionClientOf(id)).toBe('passkey');
    await section.getByRole('button', { name: 'Entfernen', exact: true }).click();
    await expect(section.getByText('Noch kein Passkey angelegt.')).toBeVisible();
    const removed = await context.request.post('/api/v1/auth/passkeys/login', { data: { response: { id: credentials.credentials[0].credentialId } } });
    expect(removed.status()).toBe(400);
  } finally {
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
    await cdp.detach();
    removeUser(id);
  }
});
}

test('a passkey button error remains visible when autofill resumes', async ({ page, context, baseURL }) => {
  const id = await logIn(context, baseURL!);
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  try {
    await page.goto('/account');
    await page.getByRole('button', { name: 'Passkey anlegen' }).click();
    await expect(page.getByRole('button', { name: 'Entfernen', exact: true })).toBeVisible();
    await cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId, enabled: false });
    await context.clearCookies();
    const message = 'Dieser Passkey wurde entfernt. Nutze einen anderen Passkey, dein Passwort oder den Login-Link.';
    await page.route('**/api/v1/auth/passkeys/login', (route) => route.fulfill({ status: 400, json: { error: message, code: 'passkeyUnknown' } }));
    let optionRequests = 0;
    page.on('request', (request) => { if (request.url().endsWith('/auth/passkeys/login/options')) optionRequests++; });
    await page.goto('/login');
    await expect.poll(() => optionRequests).toBe(1);
    await page.getByRole('button', { name: 'Mit Passkey einloggen' }).click();
    await expect.poll(() => optionRequests).toBe(2);
    await cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId, enabled: true });
    await expect.poll(() => optionRequests).toBeGreaterThanOrEqual(3);
    await expect(page.locator('p[role="alert"]')).toHaveText(message);
  } finally {
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
    await cdp.detach();
    removeUser(id);
  }
});
