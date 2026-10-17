import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

const workerModule = execFileSync('bun', ['build', 'src/lib/push-worker.ts', '--target=browser', '--format=esm'], {
  cwd: new URL('..', import.meta.url).pathname,
}).toString();

test.beforeEach(async ({ page }) => {
  // Chromium headless denies native notifications even with grantPermissions.
  await page.addInitScript(() => Object.defineProperty(Notification, 'permission', { get: () => 'granted' }));
  await page.route('**/__push-worker-test.js', (route) => route.fulfill({ contentType: 'text/javascript', body: workerModule }));
  await page.goto('/login');
  expect(await page.evaluate(() => Notification.permission)).toBe('granted');
});

test('push fetches details with cookies and uses the same tag for duplicate signals', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const path = '/__push-worker-test.js';
    const { showPush } = await import(path);
    const notices: { title: string; options: NotificationOptions }[] = [];
    const requests: { url: string; credentials?: RequestCredentials; cache?: RequestCache }[] = [];
    const browser = window as unknown as { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> };
    const originalFetch = browser.fetch;
    browser.fetch = async (url, options) => {
      requests.push({ url: String(url), credentials: options?.credentials, cache: options?.cache });
      return Response.json({ notification: { id: '42', title: 'Privater Track', body: 'Privater Name', url: '/projects/example' } });
    };
    const registration = { showNotification: async (title: string, options: NotificationOptions) => { notices.push({ title, options }); } };
    try {
      await showPush(registration, { type: 'notification', id: '42', title: 'Ignore payload text' });
      await showPush(registration, { type: 'notification', id: '42' });
      return { notices, requests };
    } finally { browser.fetch = originalFetch; }
  });
  expect(result.requests).toEqual(Array(2).fill({ url: '/api/v1/push/notifications/42', credentials: 'include', cache: 'no-store' }));
  expect(result.notices.map((n) => n.title)).toEqual(['Privater Track', 'Privater Track']);
  expect(result.notices.map((n) => n.options.tag)).toEqual(['notification-42', 'notification-42']);
  expect(result.notices[0].options.data.url).toBe('/projects/example');
});

test('auth, offline, timeout and malformed/legacy pushes stay visible and neutral', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const path = '/__push-worker-test.js';
    const { showPush } = await import(path);
    const notices: { title: string; options: NotificationOptions }[] = [];
    const registration = { showNotification: async (title: string, options: NotificationOptions) => { notices.push({ title, options }); } };
    const browser = window as unknown as { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> };
    const originalFetch = browser.fetch;
    try {
      for (const status of [401, 403, 404, 500]) {
        browser.fetch = async () => new Response('Private response', { status });
        await showPush(registration, { type: 'notification', id: '42' });
      }
      browser.fetch = async () => { throw new TypeError('offline'); };
      await showPush(registration, { type: 'notification', id: '42' });
      browser.fetch = async (_url, options) => new Promise((_resolve, reject) => {
        options!.signal!.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError')));
      });
      await showPush(registration, { type: 'notification', id: '42' });
      for (const invalid of [undefined, {}, { title: 'Private old title', body: 'Private old body' }, { type: 'notification', id: '../private' }]) {
        await showPush(registration, invalid);
      }
      return notices;
    } finally { browser.fetch = originalFetch; }
  });
  expect(result).toHaveLength(10);
  for (const n of result) {
    expect(n.title).toBe('Music Hub');
    expect(n.options.body).toBe('Öffne Music Hub, um Neuigkeiten zu sehen.');
    expect(n.options.data.url).toBe('/for-you');
  }
});

test('foreground catch-up persists only a per-account cursor and retries failures', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const path = '/__push-worker-test.js';
    const { syncPush } = await import(path);
    const notices: string[] = [];
    const requests: string[] = [];
    const registration = {
      pushManager: { getSubscription: async () => ({}) },
      showNotification: async (title: string) => { notices.push(title); },
    };
    const browser = window as unknown as { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> };
    const originalFetch = browser.fetch;
    let account = 'A';
    let fail = true;
    browser.fetch = async (url) => {
      requests.push(String(url));
      if (fail) throw new TypeError('offline');
      const query = new URL(String(url), location.origin).searchParams;
      const first = query.get('account') !== account || query.get('since') === '0';
      return Response.json({ userId: account, cursor: account === 'A' ? '42' : '43', more: false,
        notifications: first ? [{ id: account === 'A' ? '42' : '43', title: `Private ${account}`, body: 'Details', url: '/for-you' }] : [] });
    };
    try {
      await syncPush(registration);
      fail = false;
      await syncPush(registration);
      await syncPush(registration);
      account = 'B';
      await syncPush(registration);
      await syncPush(registration);
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open('musichub-push');
        request.onsuccess = () => resolve(request.result);
      });
      const stored = await new Promise<unknown>((resolve) => {
        const read = db.transaction('cursor').objectStore('cursor').get('current');
        read.onsuccess = () => resolve(read.result);
      });
      db.close();
      return { notices, requests, stored };
    } finally { browser.fetch = originalFetch; }
  });
  expect(result.notices).toEqual(['Private A', 'Private B']);
  expect(result.requests).toEqual([
    '/api/v1/push/notifications?account=&since=0',
    '/api/v1/push/notifications?account=&since=0',
    '/api/v1/push/notifications?account=A&since=42',
    '/api/v1/push/notifications?account=A&since=42',
    '/api/v1/push/notifications?account=B&since=43',
  ]);
  expect(result.stored).toEqual({ userId: 'B', cursor: '43' });
});

test('installed service worker fetches details with its cookie and falls back after logout', async ({ page, context, baseURL }) => {
  const { logIn, removeUser } = await import('./session');
  const userId = await logIn(context, baseURL!);
  try {
    const id = execFileSync('bun', ['-e', `
      import { createDb, projects, projectMembers } from '@music-hub/db';
      import { saveNotifications } from './src/lib/push-notifications.ts';
      const db = createDb(process.env.DATABASE_URL);
      const [project] = await db.insert(projects).values({ name: 'Push browser test', createdById: ${JSON.stringify(userId)} }).returning();
      await db.insert(projectMembers).values({ projectId: project.id, userId: ${JSON.stringify(userId)}, role: 'owner' });
      const [notice] = await saveNotifications(db, [${JSON.stringify(userId)}], { projectId: project.id, title: 'Browser push test', body: 'Isolated test details', url: '/projects/' + project.id });
      console.log(notice.id.toString());
      await db.$client.end();
    `], { cwd: new URL('../../api', import.meta.url).pathname }).toString().trim();
    await page.reload();
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await expect.poll(() => context.serviceWorkers().length).toBeGreaterThan(0);
    const worker = context.serviceWorkers()[0];
    // Capture only the native display boundary; push dispatch, fetch and cookies are real.
    await worker.evaluate(() => {
      const scope = self as unknown as { registration: ServiceWorkerRegistration; notices: { title: string; body?: string; tag?: string }[] };
      scope.notices = [];
      scope.registration.showNotification = async (title, options) => {
        scope.notices.push({ title, body: options?.body, tag: options?.tag });
      };
    });
    const cdp = await context.newCDPSession(page);
    let registrationId: string | undefined;
    cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
      registrationId = registrations.find((r) => r.scopeURL === `${baseURL}/`)?.registrationId ?? registrationId;
    });
    await cdp.send('ServiceWorker.enable');
    await expect.poll(() => registrationId).toBeTruthy();
    const push = () => cdp.send('ServiceWorker.deliverPushMessage', {
      origin: baseURL!, registrationId: registrationId!, data: JSON.stringify({ type: 'notification', id }),
    });
    const notifications = () => worker.evaluate(() => (self as unknown as { notices: { title: string; body?: string; tag?: string }[] }).notices);
    await push();
    await expect.poll(notifications).toContainEqual({ title: 'Browser push test', body: 'Isolated test details', tag: `notification-${id}` });
    await context.clearCookies();
    await push();
    await expect.poll(notifications).toContainEqual({ title: 'Music Hub', body: 'Öffne Music Hub, um Neuigkeiten zu sehen.', tag: `notification-${id}` });
    await cdp.detach();
  } finally { removeUser(userId); }
});

test('catch-up does not show an already delivered push again', async ({ page }) => {
  const titles = await page.evaluate(async () => {
    const path = '/__push-worker-test.js';
    const { showPush, syncPush } = await import(path);
    const titles: string[] = [];
    const notice = { id: '42', title: 'Already delivered', body: 'Private', url: '/for-you' };
    const registration = {
      pushManager: { getSubscription: async () => ({}) },
      showNotification: async (title: string) => { titles.push(title); },
    };
    const original = window.fetch;
    Object.defineProperty(window, 'fetch', { configurable: true, writable: true, value: async () => Response.json({
      notification: notice, notifications: [notice], userId: 'A', cursor: '42', more: false,
    }) });
    try {
      await showPush(registration, { type: 'notification', id: '42' });
      await syncPush(registration);
      return titles;
    } finally { window.fetch = original; }
  });
  expect(titles).toEqual(['Already delivered']);
});
