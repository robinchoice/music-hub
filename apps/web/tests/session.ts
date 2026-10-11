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
