import { execFileSync } from 'node:child_process';
import type { BrowserContext } from '@playwright/test';

// The API package writes straight into DATABASE_URL, like the API tests: own rows only, removed again
const bun = (code: string) =>
  execFileSync('bun', ['-e', `import { createDb, projects, sessions, users } from '@music-hub/db';\nconst db = createDb(process.env.DATABASE_URL);\n${code}\nprocess.exit(0);`], {
    cwd: new URL('../../api', import.meta.url).pathname,
  })
    .toString()
    .trim()
    .split('\n')
    .at(-1)!;

// A fresh user, logged in for the context
export async function logIn(context: BrowserContext, baseURL: string, name = 'Testperson') {
  const { id, token } = JSON.parse(
    bun(`
      import { generateToken, hashToken } from './src/middleware/auth.ts';
      const [u] = await db.insert(users).values({ email: 'test-' + crypto.randomUUID() + '@example.com', name: ${JSON.stringify(name)} }).returning();
      const token = generateToken();
      await db.insert(sessions).values({ userId: u.id, tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + 3600_000) });
      console.log(JSON.stringify({ id: u.id, token }));
    `),
  );
  await context.addCookies([{ name: 'session', value: token, url: baseURL }]);
  return id as string;
}

export function removeUser(id: string) {
  bun(`
    import { eq } from 'drizzle-orm';
    await db.delete(projects).where(eq(projects.createdById, ${JSON.stringify(id)}));
    await db.delete(users).where(eq(users.id, ${JSON.stringify(id)}));
  `);
}

// A version the worker gave up on: ready, but without duration, stream or waveform
export function addUnprocessedVersion(trackId: string, userId: string) {
  bun(`
    import { versions } from '@music-hub/db';
    await db.insert(versions).values({ trackId: ${JSON.stringify(trackId)}, versionNumber: 1, status: 'ready', label: 'kaputt', originalFileName: 'kaputt.wav', mimeType: 'audio/wav', fileSize: 7, originalFileKey: 'test/' + crypto.randomUUID() + '/kaputt.wav', createdById: ${JSON.stringify(userId)} });
  `);
}

// A version as it comes from the upload; returns its id
export function addVersion(trackId: string, userId: string, status: 'processing' | 'ready', versionNumber = 1, fileSize = 7) {
  return bun(`
    import { versions } from '@music-hub/db';
    const [v] = await db.insert(versions).values({ trackId: ${JSON.stringify(trackId)}, versionNumber: ${versionNumber}, status: ${JSON.stringify(status)}, duration: ${status === 'ready' ? 180 : null}, originalFileName: 'mix.wav', mimeType: 'audio/wav', fileSize: ${fileSize}, originalFileKey: 'test/' + crypto.randomUUID() + '/mix.wav', createdById: ${JSON.stringify(userId)} }).returning();
    console.log(v.id);
  `);
}

// What the worker does when it is done: the version is ready and every open track page hears it
export function finishProcessing(trackId: string, versionId: string) {
  bun(`
    import { eq } from 'drizzle-orm';
    import { versions } from '@music-hub/db';
    await db.update(versions).set({ status: 'ready', duration: 180 }).where(eq(versions.id, ${JSON.stringify(versionId)}));
    await db.$client.notify('track_events', JSON.stringify({ trackId: ${JSON.stringify(trackId)}, type: 'version:status', data: { versionId: ${JSON.stringify(versionId)}, status: 'ready' } }));
  `);
}

// People invited by a test get an account of their own
export function removeEmail(email: string) {
  bun(`
    import { eq } from 'drizzle-orm';
    import { magicLinks } from '@music-hub/db';
    await db.delete(magicLinks).where(eq(magicLinks.email, ${JSON.stringify(email)}));
    await db.delete(users).where(eq(users.email, ${JSON.stringify(email)}));
  `);
}

// Someone else in the project; removeUser takes them out again
export function addMember(projectId: string, name = 'Lena') {
  return bun(`
    import { projectMembers } from '@music-hub/db';
    const [u] = await db.insert(users).values({ email: 'test-' + crypto.randomUUID() + '@example.com', name: ${JSON.stringify(name)} }).returning();
    await db.insert(projectMembers).values({ projectId: ${JSON.stringify(projectId)}, userId: u.id, role: 'artist' });
    console.log(u.id);
  `);
}

// A stem with as many earlier files as given; returns its id
export function addStem(trackId: string, userId: string, name: string, earlier = 0) {
  return bun(`
    import { stems, stemRevisions } from '@music-hub/db';
    const file = (n) => ({ originalFileName: n + '.wav', mimeType: 'audio/wav', fileSize: 7, fileKey: 'test/' + crypto.randomUUID() + '/' + n + '.wav', createdById: ${JSON.stringify(userId)} });
    const [s] = await db.insert(stems).values({ trackId: ${JSON.stringify(trackId)}, name: ${JSON.stringify(name)}, ...file(${JSON.stringify(name)}) }).returning();
    for (let i = 1; i <= ${earlier}; i++) await db.insert(stemRevisions).values({ stemId: s.id, ...file(${JSON.stringify(name)} + '-take' + i), createdAt: new Date(Date.now() - (${earlier} - i + 2) * 60000), replacedAt: new Date(Date.now() - (${earlier} - i + 1) * 60000) });
    console.log(s.id);
  `);
}

// The token behind the unsubscribe link in the user's mails
export function mailTokenOf(userId: string) {
  return bun(`
    import { eq } from 'drizzle-orm';
    const [u] = await db.select({ mailToken: users.mailToken }).from(users).where(eq(users.id, ${JSON.stringify(userId)}));
    console.log(u.mailToken);
  `);
}
