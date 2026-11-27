import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { eq, inArray } from 'drizzle-orm';
import { gunzipSync, unzipSync } from 'fflate';
import { comments, createDb, migrateDb, projectMembers, projects, sessions, stems, tracks, users, versions } from '@music-hub/db';
import { rightsOfRoles } from '@music-hub/shared';
import { generateToken, hashToken } from './middleware/auth.js';
import type { AppEnv } from './types.js';

// A 16-bit stereo WAV of the given length, served as every stem
function wav(seconds: number, sampleRate = 48000) {
  const data = seconds * sampleRate * 4;
  const file = new Uint8Array(44 + data);
  const view = new DataView(file.buffer);
  file.set(new TextEncoder().encode('RIFF'), 0);
  view.setUint32(4, 36 + data, true);
  file.set(new TextEncoder().encode('WAVEfmt '), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  file.set(new TextEncoder().encode('data'), 36);
  view.setUint32(40, data, true);
  return file;
}
const objects = new Map<string, Uint8Array<ArrayBuffer>>();
const s3 = await import('./storage/s3.js');
mock.module('./storage/s3.js', () => ({ ...s3, getObjectStream: async (key: string) => new Blob([objects.get(key)!]).stream() }));
const { stemRoutes } = await import('./routes/stems.js');

// Runs against DATABASE_URL with rows of its own, which go again at the end
const db = createDb(process.env.DATABASE_URL!);
const app = new Hono<AppEnv>().use('*', async (c, next) => { c.set('db', db); await next(); }).route('/stems', stemRoutes);
const userIds: string[] = [];
let ownerHeaders: Record<string, string>, viewerHeaders: Record<string, string>, ownerId: string, trackId: string;

const person = async (name: string) => {
  const [u] = await db.insert(users).values({ email: `test-${crypto.randomUUID()}@example.com`, name }).returning();
  userIds.push(u.id);
  const token = generateToken();
  await db.insert(sessions).values({ userId: u.id, tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + 300_000) });
  return { id: u.id, headers: { authorization: `Bearer ${token}` } };
};
const stem = async (name: string, fileName: string, file: Uint8Array<ArrayBuffer>, sortOrder: number) => {
  const fileKey = `test/${crypto.randomUUID()}/${fileName}`;
  objects.set(fileKey, file);
  await db.insert(stems).values({ trackId, name, originalFileName: fileName, mimeType: 'audio/wav', fileSize: file.length, fileKey, sortOrder, createdById: ownerId });
};

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  const [owner, viewer] = [await person('Robin'), await person('Lea')];
  [ownerId, ownerHeaders, viewerHeaders] = [owner.id, owner.headers, viewer.headers];
  const [project] = await db.insert(projects).values({ name: 'Fernlicht', createdById: ownerId }).returning();
  await db.insert(projectMembers).values([
    { projectId: project.id, userId: ownerId, role: 'owner', ...rightsOfRoles(['owner']) },
    { projectId: project.id, userId: viewer.id, role: 'viewer', ...rightsOfRoles(['viewer']) },
  ]);
  const [track] = await db.insert(tracks).values({ projectId: project.id, name: 'Nacht/Bus', createdById: ownerId }).returning();
  trackId = track.id;
  const version = (versionNumber: number, bpm: number | null) =>
    db.insert(versions).values({
      trackId, versionNumber, bpm, status: 'ready', originalFileName: 'mix.wav', mimeType: 'audio/wav', fileSize: 5000,
      originalFileKey: `test/${crypto.randomUUID()}/mix.wav`, createdById: ownerId,
    }).returning();
  await version(1, 80);
  const [v2] = await version(2, 96);
  await db.insert(comments).values([
    { versionId: v2.id, userId: viewer.id, body: 'Kick\nlauter', timestampSeconds: 2.5 },
    { versionId: v2.id, guestName: 'Mo', body: 'Hier Break', timestampSeconds: 2.5 },
    { versionId: v2.id, userId: ownerId, body: 'Erledigt', timestampSeconds: 4, resolvedAt: new Date() },
    { versionId: v2.id, userId: ownerId, body: 'Ohne Zeit' },
  ]);
  await stem('Bass', 'bass.wav', wav(2), 0);
  await stem('Drums', 'drums.wav', wav(2), 1);
  await stem('Notes', 'bass.wav', new TextEncoder().encode('no audio'), 2);
});

afterAll(async () => {
  await db.delete(projects).where(inArray(projects.createdById, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
  await db.$client.end();
});

test('the Ableton project holds the stems and a set with their tracks, the tempo and the open comments', async () => {
  const res = await app.request(`/stems/track/${trackId}/ableton`, { headers: ownerHeaders });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-disposition')).toBe('attachment; filename="nacht-bus-ableton.zip"');
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  expect(Object.keys(files)).toEqual([
    'Nacht_Bus Project/Ableton Project Info/',
    'Nacht_Bus Project/Samples/Imported/bass.wav',
    'Nacht_Bus Project/Samples/Imported/drums.wav',
    'Nacht_Bus Project/Samples/Imported/bass (2).wav',
    'Nacht_Bus Project/Nacht_Bus.als',
  ]);
  expect(files['Nacht_Bus Project/Samples/Imported/drums.wav']).toEqual(wav(2));

  const set = new TextDecoder().decode(gunzipSync(files['Nacht_Bus Project/Nacht_Bus.als']!));
  // The file that isn't audio stays in the folder without a track
  expect([...set.matchAll(/<AudioTrack Id="\d+".*?<EffectiveName Value="([^"]*)"/g)].map((m) => m[1])).toEqual(['Bass', 'Drums']);
  expect(set).toContain('<RelativePath Value="Samples/Imported/drums.wav"/>');
  expect(set).toContain('<DefaultDuration Value="96000"/>');
  expect(set).toContain('<Tempo><LomId Value="0"/><Manual Value="96"/>');
  // 2 s at 96 BPM are 3.2 beats
  expect(set).toContain('<CurrentEnd Value="3.2"/>');
  expect([...set.matchAll(/<Locator Id="\d+"><LomId Value="0"\/><Time Value="([^"]*)"\/><Name Value="([^"]*)"/g)].map((m) => [m[1], m[2]])).toEqual([
    ['4', 'Lea: Kick lauter / Mo: Hier Break'],
  ]);
});

test('the Ableton project follows the download right', async () => {
  expect((await app.request(`/stems/track/${trackId}/ableton`, { headers: viewerHeaders })).status).toBe(403);
  await db.update(projectMembers).set({ canDownload: true }).where(eq(projectMembers.userId, userIds[1]!));
  const res = await app.request(`/stems/track/${trackId}/ableton`, { headers: viewerHeaders });
  expect(res.status).toBe(200);
  await res.body?.cancel();
});
