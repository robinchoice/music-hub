import { afterAll, beforeAll, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { createDb, listenEvents, magicLinks, migrateDb, projects, sessions, shareLinks, tracks, users, versions } from '@music-hub/db';
import { LISTEN_DETAILS_DAYS, pruneExpired, USED_LINK_DAYS } from './lib/cleanup.js';

// Runs against DATABASE_URL; the rows are its own and go again at the end
const db = createDb(process.env.DATABASE_URL!);
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
let userId: string;
let projectId: string;
const email = `test-${crypto.randomUUID()}@example.com`;

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  [{ id: userId }] = await db.insert(users).values({ email, name: 'Test' }).returning({ id: users.id });
  [{ id: projectId }] = await db.insert(projects).values({ name: 'Test', createdById: userId }).returning({ id: projects.id });
});

afterAll(async () => {
  await db.delete(magicLinks).where(eq(magicLinks.email, email));
  await db.delete(projects).where(eq(projects.id, projectId));
  await db.delete(users).where(eq(users.id, userId));
  await db.$client.end();
});

test('expired sessions and links go, the rest stays', async () => {
  const token = () => crypto.randomUUID().replaceAll('-', '');
  const session = (expiresAt: Date) => ({ userId, tokenHash: token(), expiresAt });
  const [expired, live] = await db
    .insert(sessions)
    .values([session(ago(1)), session(ago(-1))])
    .returning({ id: sessions.id });
  const link = (expiresAt: Date, usedAt: Date | null) => ({ email, token: token(), expiresAt, usedAt });
  const [unused, pending, recent, old] = await db
    .insert(magicLinks)
    .values([
      link(ago(1), null),
      link(ago(-1), null),
      link(ago(10), ago(10)),
      link(ago(USED_LINK_DAYS + 1), ago(USED_LINK_DAYS + 1)),
    ])
    .returning({ id: magicLinks.id });

  await pruneExpired(db);

  const sessionIds = (await db.select({ id: sessions.id }).from(sessions).where(inArray(sessions.id, [expired.id, live.id]))).map((s) => s.id);
  expect(sessionIds).toEqual([live.id]);
  const linkIds = (await db.select({ id: magicLinks.id }).from(magicLinks).where(eq(magicLinks.email, email))).map((l) => l.id);
  expect(linkIds.sort()).toEqual([pending.id, recent.id].sort());
  expect(linkIds).not.toContain(unused.id);
  expect(linkIds).not.toContain(old.id);
});

test('old listens lose the IP hash and the browser, but keep their numbers', async () => {
  const [{ id: trackId }] = await db.insert(tracks).values({ projectId, name: 'Test', createdById: userId }).returning({ id: tracks.id });
  const [{ id: versionId }] = await db
    .insert(versions)
    .values({
      trackId,
      versionNumber: 1,
      originalFileName: 'test.wav',
      mimeType: 'audio/wav',
      fileSize: 1,
      originalFileKey: `test/${crypto.randomUUID()}.wav`,
      createdById: userId,
    })
    .returning({ id: versions.id });
  const [{ id: shareLinkId }] = await db
    .insert(shareLinks)
    .values({ versionId, token: crypto.randomUUID(), createdById: userId })
    .returning({ id: shareLinks.id });
  const listen = (openedAt: Date) => ({ shareLinkId, ipHash: 'abc', userAgent: 'Firefox', listenerName: 'Gast', openedAt, listenSeconds: 42 });
  const [old, recent] = await db
    .insert(listenEvents)
    .values([listen(ago(LISTEN_DETAILS_DAYS + 1)), listen(ago(1))])
    .returning({ id: listenEvents.id });

  await pruneExpired(db);

  const [oldAfter] = await db.select().from(listenEvents).where(eq(listenEvents.id, old.id));
  expect(oldAfter).toMatchObject({ ipHash: null, userAgent: null, listenerName: 'Gast', listenSeconds: 42 });
  const [recentAfter] = await db.select().from(listenEvents).where(eq(listenEvents.id, recent.id));
  expect(recentAfter).toMatchObject({ ipHash: 'abc', userAgent: 'Firefox' });
});
