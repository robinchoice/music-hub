import { afterAll, beforeAll, expect, test } from 'bun:test';
import { and, eq, inArray } from 'drizzle-orm';
import {
  contactRequests,
  createDb,
  migrateDb,
  openTracks,
  projectMembers,
  projects,
  stars,
  stems,
  tracks,
  users,
  versions,
} from '@music-hub/db';
import { acceptRequest, contactState, declineRequest, openTracksOf, pendingRequests, suggestHandle } from './lib/profiles.js';

// Runs against DATABASE_URL with rows of its own, which go again at the end
const db = createDb(process.env.DATABASE_URL!);
const userIds: string[] = [];
let robin: string, lea: string, mara: string, spam: string;
let bandProject: string, trackId: string;

const user = async (name: string) => {
  const [u] = await db.insert(users).values({ email: `test-${crypto.randomUUID()}@example.com`, name }).returning();
  userIds.push(u.id);
  return u.id;
};
const profile = (userId: string, requestsFrom = 'open') =>
  ({ userId, handle: `t-${crypto.randomUUID().slice(0, 8)}`, requestsFrom }) as const;
const send = async (fromUserId: string, toUserId: string, message = 'Lust auf einen Remix?') => {
  const [r] = await db.insert(contactRequests).values({ fromUserId, toUserId, message }).returning();
  return r.id;
};

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  [robin, lea, mara, spam] = [await user('Robin'), await user('Lea'), await user('Mara'), await user('Promo')];
  [{ id: bandProject }] = await db.insert(projects).values({ name: 'Fernlicht', artist: 'Fernlicht', createdById: robin }).returning();
  await db.insert(projectMembers).values([
    { projectId: bandProject, userId: robin, role: 'owner', canUpload: true },
    { projectId: bandProject, userId: lea, role: 'artist', canUpload: true },
  ]);
  [{ id: trackId }] = await db.insert(tracks).values({ projectId: bandProject, name: 'Nachtbus', createdById: robin }).returning();
  const [version] = await db
    .insert(versions)
    .values({
      trackId,
      versionNumber: 1,
      status: 'approved',
      originalFileName: 'mix.wav',
      mimeType: 'audio/wav',
      fileSize: 5000,
      originalFileKey: `test/${crypto.randomUUID()}/mix.wav`,
      createdById: robin,
    })
    .returning();
  await db.insert(stems).values({
    trackId,
    name: 'Vocals',
    originalFileName: 'vocals.wav',
    mimeType: 'audio/wav',
    fileSize: 1000,
    fileKey: `test/${crypto.randomUUID()}/vocals.wav`,
    createdById: lea,
    createdAt: new Date(Date.now() - 60_000),
  });
  await db.insert(openTracks).values({ trackId, versionId: version.id, license: 'cc-by', requestedById: robin, openedAt: new Date() });
});

afterAll(async () => {
  await db.delete(projects).where(inArray(projects.createdById, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
  await db.$client.end();
});

test('a profile lists the open tracks someone opened or uploaded stems to', async () => {
  await db.insert(stars).values([{ userId: mara, trackId }, { userId: spam, trackId }]);
  const [ofRobin] = await openTracksOf(db, robin);
  expect(ofRobin).toMatchObject({ id: trackId, artist: 'Fernlicht', stemCount: 1, stars: 2 });
  expect((await openTracksOf(db, lea)).map((t) => t.id)).toEqual([trackId]);
  expect(await openTracksOf(db, mara)).toHaveLength(0);
});

test('only people with an open track of their own may ask by default', async () => {
  const p = profile(robin);
  expect(await contactState(db, p, undefined)).toBe('login');
  expect(await contactState(db, p, robin)).toBe('self');
  expect(await contactState(db, p, mara)).toBe('needs-open');
  expect(await contactState(db, p, lea)).toBe('allowed');
  expect(await contactState(db, { ...p, requestsFrom: 'everyone' }, mara)).toBe('allowed');
  expect(await contactState(db, { ...p, requestsFrom: 'nobody' }, lea)).toBe('closed');
});

test('accepting puts the sender into a new project with the message', async () => {
  const id = await send(mara, robin);
  expect((await pendingRequests(db, robin)).map((r) => r.id)).toContain(id);
  expect(await contactState(db, profile(robin, 'everyone'), mara)).toBe('sent');
  // Only the recipient can accept
  expect(await acceptRequest(db, id, lea)).toBeNull();

  const result = await acceptRequest(db, id, robin);
  const [project] = await db.select().from(projects).where(eq(projects.id, result!.projectId));
  expect(project).toMatchObject({ name: 'Robin × Mara', description: 'Anfrage von Mara: Lust auf einen Remix?', createdById: robin });
  const members = await db.select().from(projectMembers).where(eq(projectMembers.projectId, project.id));
  expect(members.map((m) => [m.userId, m.role]).sort()).toEqual([[mara, 'artist'], [robin, 'owner']].sort());
  expect(await acceptRequest(db, id, robin)).toBeNull();
});

test('accepting into an existing project needs the right to invite there', async () => {
  const id = await send(mara, lea);
  expect(await acceptRequest(db, id, lea, bandProject)).toBeNull();
  const own = await send(mara, robin, 'Noch was');
  expect(await acceptRequest(db, own, robin, bandProject)).toEqual({ projectId: bandProject, fromUserId: mara });
});

test('a decline is silent and keeps the sender from asking again for a while; a block for good', async () => {
  const p = profile(lea, 'everyone');
  const id = await send(spam, lea, 'Playlist-Promo, nur 49 €');
  expect(await declineRequest(db, id, robin)).toBeNull();
  expect(await declineRequest(db, id, lea)).not.toBeNull();
  expect(await contactState(db, p, spam)).toBe('sent');

  await db.update(contactRequests).set({ answeredAt: new Date(Date.now() - 31 * 86_400_000) }).where(eq(contactRequests.id, id));
  expect(await contactState(db, p, spam)).toBe('allowed');

  const again = await send(spam, lea, 'Letzte Chance');
  await declineRequest(db, again, lea, true, true);
  await db.update(contactRequests).set({ answeredAt: new Date(0) }).where(eq(contactRequests.id, again));
  expect(await contactState(db, p, spam)).toBe('closed');
  const [reported] = await db.select().from(contactRequests).where(and(eq(contactRequests.id, again)));
  expect(reported.reportedAt).not.toBeNull();
});

test('handles come from the display name', () => {
  expect(suggestHandle('Lea Brandt')).toBe('lea-brandt');
  expect(suggestHandle('Die Spätzles!')).toBe('die-spaetzles');
  expect(suggestHandle('Æ')).toBe('musik');
});

