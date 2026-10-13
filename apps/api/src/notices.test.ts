import { afterAll, beforeAll, expect, test } from 'bun:test';
import { eq, inArray, sql } from 'drizzle-orm';
import { createDb, migrateDb, projectMembers, projects, pushSubscriptions, tracks, users, versionNotices, versions } from '@music-hub/db';
import { queueVersionNotice, takeDueNotices } from './lib/notices.js';

// Runs against DATABASE_URL with rows of its own, which go again at the end
const db = createDb(process.env.DATABASE_URL!);
const userIds: string[] = [];
let robin: string, lena: string, tom: string, mira: string, projectId: string, trackId: string;
let versionNumber = 0;

const user = async (name: string) => {
  const [u] = await db.insert(users).values({ email: `test-${crypto.randomUUID()}@example.com`, name }).returning();
  userIds.push(u.id);
  return u.id;
};
const upload = async (minutesAgo: number, track = trackId) => {
  const [v] = await db
    .insert(versions)
    .values({
      trackId: track,
      versionNumber: ++versionNumber,
      originalFileName: 'mix.wav',
      mimeType: 'audio/wav',
      fileSize: 1000,
      originalFileKey: `test/${crypto.randomUUID()}/mix.wav`,
      createdById: robin,
    })
    .returning();
  await queueVersionNotice(db, projectId, robin, v.id);
  await db
    .update(versionNotices)
    .set({ createdAt: sql`now() - ${`${minutesAgo} minutes`}::interval` })
    .where(eq(versionNotices.versionId, v.id));
  return v;
};
// Only this test's project; other notices in the database are none of its business
const due = async () => (await takeDueNotices(db)).filter((b) => b.projectId === projectId);

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  [robin, lena, tom, mira] = [await user('Robin'), await user('Lena'), await user('Tom'), await user('Mira')];
  const [project] = await db.insert(projects).values({ name: 'Tiefgang', createdById: robin }).returning();
  projectId = project.id;
  await db.insert(projectMembers).values([
    { projectId, userId: robin, role: 'owner' },
    { projectId, userId: lena, role: 'artist' },
    { projectId, userId: tom, role: 'label' },
    { projectId, userId: mira, role: 'viewer' },
  ]);
  [{ id: trackId }] = await db.insert(tracks).values({ projectId, name: 'Nachtbus', createdById: robin }).returning();
  await db.insert(pushSubscriptions).values({ userId: lena, endpoint: `https://push.example.com/${crypto.randomUUID()}`, p256dh: 'x', auth: 'x' });
  await db.update(users).set({ versionMails: false }).where(eq(users.id, mira));
});

afterAll(async () => {
  await db.delete(projects).where(inArray(projects.createdById, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
  await db.$client.end();
});

test('a batch waits while the uploader is still busy', async () => {
  await upload(5);
  await upload(0);
  expect(await due()).toHaveLength(0);
});

test('once the uploader pauses, the whole batch goes out as one', async () => {
  await db.update(versionNotices).set({ createdAt: sql`now() - interval '3 minutes'` }).where(eq(versionNotices.projectId, projectId));
  const [batch, ...rest] = await due();
  expect(rest).toHaveLength(0);
  expect(batch).toMatchObject({ projectName: 'Tiefgang', actorName: 'Robin' });
  expect(batch.items.map((i) => i.versionNumber)).toEqual([1, 2]);
  // Push for members with a subscription, mail for the others unless they turned it off, never the uploader
  expect(batch.pushTo).toEqual([lena]);
  expect(batch.mailTo.map((m) => m.email)).toHaveLength(1);
  const [tomRow] = await db.select().from(users).where(eq(users.id, tom));
  expect(batch.mailTo[0]).toEqual({ email: tomRow.email, mailToken: tomRow.mailToken });
  expect(await due()).toHaveLength(0);
});

test('a steady stream of uploads still goes out after the longest wait', async () => {
  await upload(11);
  await upload(0);
  const [batch] = await due();
  expect(batch.items).toHaveLength(2);
});

test('versions moved to the trash before the batch goes out stay quiet', async () => {
  const v = await upload(3);
  await db.update(versions).set({ deletedAt: new Date(), deletedById: robin }).where(eq(versions.id, v.id));
  expect(await due()).toHaveLength(0);
  expect(await db.select().from(versionNotices).where(eq(versionNotices.projectId, projectId))).toHaveLength(0);
});
