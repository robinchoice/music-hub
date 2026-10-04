/**
 * Test data for the overview pages (Übersicht, Für dich, Tracks, Timeline, Mischpult).
 *
 * Usage (local only, needs ffmpeg plus Postgres and MinIO from docker compose):
 *   bun run apps/api/src/scripts/seed-overview.ts
 *
 * Creates robin@example.test (owner), jonas@example.test (mixing engineer), lena@example.test and
 * tom@example.test (artists) and neu@example.test (no project). Adds the projects "Kaltfront EP",
 * "Glas" and "Alte Aufnahmen" with versions spread over the last weeks, comments, replies,
 * decisions, share links and listens. Running it again adds another copy of the projects.
 */
import { eq } from 'drizzle-orm';
import {
  createDb,
  users,
  projects,
  projectMembers,
  tracks,
  versions,
  comments,
  shareLinks,
  listenEvents,
} from '@music-hub/db';
import type { ProjectRole } from '@music-hub/shared';
import { putObject } from '../storage/s3.js';
import { processVersion } from '../services/audio-processor.js';

const db = createDb(process.env.DATABASE_URL!);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms);

type Ref = { id: string };

// Creates the account or renames it, e.g. "robin" from seed.ts becomes "Robin"
async function user(email: string, name: string) {
  const [row] = await db
    .insert(users)
    .values({ email, name })
    .onConflictDoUpdate({ target: users.email, set: { name } })
    .returning();
  return row;
}

const PERMISSIONS: Partial<Record<ProjectRole, { canUpload: boolean; canComment: boolean; canApprove: boolean }>> = {
  owner: { canUpload: true, canComment: true, canApprove: true },
  mixing_engineer: { canUpload: true, canComment: true, canApprove: false },
  artist: { canUpload: false, canComment: true, canApprove: true },
};

async function project(name: string, artist: string, owner: Ref, members: [Ref, ProjectRole][]) {
  const [p] = await db.insert(projects).values({ name, artist, createdById: owner.id }).returning();
  for (const [member, role] of members) {
    await db.insert(projectMembers).values({ projectId: p.id, userId: member.id, role, ...PERMISSIONS[role]! });
  }
  return p;
}

async function track(projectId: string, name: string, status: 'sketch' | 'in_progress' | 'final' | 'released', by: Ref, createdAgo: number) {
  const [t] = await db.insert(tracks).values({ projectId, name, status, createdById: by.id, createdAt: ago(createdAgo) }).returning();
  return t;
}

// Every version gets its own test tone, so waveforms, lengths and loudness differ.
async function version(t: { id: string; projectId: string }, n: number, label: string, by: Ref, createdAgo: number, tone: { freq: number; seconds: number; volume: number }) {
  const id = crypto.randomUUID();
  const file = `/tmp/musichub-seed-${id}.wav`;
  const ff = Bun.spawnSync([
    'ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', `sine=frequency=${tone.freq}:duration=${tone.seconds}`,
    '-af', `volume=${tone.volume},tremolo=f=0.4:d=0.8`,
    '-ac', '2', file,
  ]);
  if (ff.exitCode !== 0) throw new Error(ff.stderr.toString());
  const bytes = await Bun.file(file).bytes();
  const key = `projects/${t.projectId}/tracks/${t.id}/versions/${id}/original/v${n}.wav`;
  await putObject(key, bytes, 'audio/wav');
  const [v] = await db
    .insert(versions)
    .values({
      id,
      trackId: t.id,
      versionNumber: n,
      label,
      status: 'uploaded',
      originalFileName: `v${n}.wav`,
      mimeType: 'audio/wav',
      fileSize: bytes.byteLength,
      originalFileKey: key,
      createdById: by.id,
      createdAt: ago(createdAgo),
    })
    .returning();
  await processVersion(db, v.id);
  console.log(`  ${label} (V${n})`);
  return v;
}

async function decide(v: Ref, status: 'approved' | 'rejected', by: Ref | null, decidedAgo: number, reason?: string) {
  await db
    .update(versions)
    .set({ status, decidedById: by?.id ?? null, decidedAt: by ? ago(decidedAgo) : null })
    .where(eq(versions.id, v.id));
  if (reason && by) {
    await db.insert(comments).values({ versionId: v.id, userId: by.id, body: `❌ Abgelehnt: ${reason}`, createdAt: ago(decidedAgo) });
  }
}

async function comment(v: Ref, by: Ref | string, body: string, t: number | null, createdAgo: number, opts: { resolvedAgo?: number; parentId?: string } = {}) {
  const [c] = await db
    .insert(comments)
    .values({
      versionId: v.id,
      userId: typeof by === 'string' ? null : by.id,
      guestName: typeof by === 'string' ? by : null,
      body,
      timestampSeconds: t,
      parentId: opts.parentId ?? null,
      resolvedAt: opts.resolvedAgo !== undefined ? ago(opts.resolvedAgo) : null,
      createdAt: ago(createdAgo),
    })
    .returning();
  return c;
}

async function shareWithListens(v: Ref, by: Ref, listens: { name: string | null; openedAgo: number; seconds: number; completed: boolean }[]) {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
  const [link] = await db.insert(shareLinks).values({ versionId: v.id, token, createdById: by.id, allowComments: true }).returning();
  for (const l of listens) {
    await db.insert(listenEvents).values({
      shareLinkId: link.id,
      listenerName: l.name,
      openedAt: ago(l.openedAgo),
      firstPlayAt: ago(l.openedAgo - 5000),
      listenSeconds: l.seconds,
      completed: l.completed,
    });
  }
}

console.log('→ Konten');
const robin = await user('robin@example.test', 'Robin');
const jonas = await user('jonas@example.test', 'Jonas Weber');
const lena = await user('lena@example.test', 'Lena Hoff');
const tom = await user('tom@example.test', 'Tom Richter');
await user('neu@example.test', 'Neu');

console.log('→ Kaltfront EP');
const kf = await project('Kaltfront EP', 'Kaltfront', robin, [[robin, 'owner'], [jonas, 'mixing_engineer'], [lena, 'artist'], [tom, 'artist']]);

const hks = await track(kf.id, 'Heute Kind Sein', 'in_progress', robin, 30 * DAY);
const hks1 = await version(hks, 1, 'Rough', robin, 21 * DAY, { freq: 220, seconds: 16, volume: 0.35 });
const hks2 = await version(hks, 2, 'Mix 1', jonas, 10 * DAY, { freq: 230, seconds: 16, volume: 0.5 });
await decide(hks2, 'rejected', robin, 9 * DAY, 'Gesang im Refrain zu weit hinten.');
const hks3 = await version(hks, 3, 'Mix 2', jonas, 5 * DAY, { freq: 240, seconds: 16, volume: 0.55 });
await comment(hks3, lena, 'Bass im Intro wummert.', 3, 4 * DAY + 3 * HOUR, { resolvedAgo: 2 * DAY });
await comment(hks3, robin, 'Übergang zur Bridge holpert.', 9, 4 * DAY + HOUR, { resolvedAgo: 2 * DAY });
const hks4 = await version(hks, 4, 'Mix 3', jonas, 2 * HOUR, { freq: 250, seconds: 16, volume: 0.6 });
const intro = await comment(hks4, robin, 'Intro jetzt richtig gut, bitte so lassen.', 1, 70 * MIN);
await comment(hks4, jonas, 'Danke, bleibt so.', null, 40 * MIN, { parentId: intro.id });
const snare = await comment(hks4, lena, 'Snare im zweiten Refrain ist mir zu laut.', 7, 25 * MIN);
await comment(hks4, jonas, 'Guter Punkt, nehm ich mit in Mix 4.', null, 10 * MIN, { parentId: snare.id });
await comment(hks4, tom, 'Gitarrensolo darf ruhig lauter.', 12, 15 * MIN);

const nb = await track(kf.id, 'Nachtbus', 'in_progress', robin, 40 * DAY);
await version(nb, 1, 'Demo', robin, 30 * DAY, { freq: 180, seconds: 14, volume: 0.3 });
const nb2 = await version(nb, 2, 'Mix 1', jonas, 4 * DAY, { freq: 190, seconds: 14, volume: 0.5 });
await comment(nb2, robin, 'Mehr Raum auf den Drums.', 2, 3 * DAY + 6 * HOUR, { resolvedAgo: DAY });
await comment(nb2, lena, 'Chor im Refrain lauter.', 8, 3 * DAY + 2 * HOUR, { resolvedAgo: DAY });
// Shorter than V1 and V2
await version(nb, 3, 'Mix 2', jonas, 20 * HOUR, { freq: 200, seconds: 12, volume: 0.55 });

const kr = await track(kf.id, 'Kreide', 'final', robin, 60 * DAY);
await version(kr, 1, 'Demo', robin, 52 * DAY, { freq: 300, seconds: 15, volume: 0.3 });
const kr2 = await version(kr, 2, 'Mix 1', jonas, 27 * DAY, { freq: 310, seconds: 15, volume: 0.5 });
await decide(kr2, 'rejected', robin, 26 * DAY, 'Zu viel Hall auf den Drums.');
const kr3 = await version(kr, 3, 'Master', jonas, 3 * DAY, { freq: 320, seconds: 15, volume: 0.95 });
await decide(kr3, 'approved', robin, DAY);

const aaa = await track(kf.id, 'Alles auf Anfang', 'sketch', robin, 16 * DAY);
const aaa1 = await version(aaa, 1, 'Demo', robin, 15 * DAY, { freq: 260, seconds: 13, volume: 0.4 });
await comment(aaa1, lena, 'Tolle Idee! Die zweite Strophe fehlt noch.', 5, 14 * DAY);
// Like versions uploaded before loudness and waveforms existed
await db.update(versions).set({ integratedLufs: null, waveformDataKey: null }).where(eq(versions.id, aaa1.id));
await db.update(versions).set({ integratedLufs: null }).where(eq(versions.id, hks1.id));

await track(kf.id, 'Beton im Juli', 'sketch', robin, 3 * DAY);

console.log('→ Glas');
const glas = await project('Glas', 'Mara Lenz', robin, [[robin, 'owner']]);
const gl = await track(glas.id, 'Glas', 'in_progress', robin, 14 * DAY);
const gl1 = await version(gl, 1, 'Mix 1', robin, 8 * DAY, { freq: 330, seconds: 13, volume: 0.45 });
await comment(gl1, 'Mara', 'Mehr Wärme in der Stimme.', 4, 7 * DAY, { resolvedAgo: 6 * DAY });
// An approval from before decisions stored a person
await decide(gl1, 'approved', null, 0);
const gl2 = await version(gl, 2, 'Mix 2', robin, 30 * HOUR, { freq: 340, seconds: 13, volume: 0.6 });
await comment(gl2, 'Mara', 'Kann der Hall auf der Stimme kürzer?', 3, 62 * MIN);
await comment(gl2, 'Mara', 'Ende bitte ausfaden statt hart.', 11, 60 * MIN);
await shareWithListens(gl2, robin, [
  { name: 'Mara', openedAgo: 66 * MIN, seconds: 13, completed: true },
  { name: 'Mara', openedAgo: 22 * HOUR, seconds: 13, completed: true },
]);
const wer = await track(glas.id, 'Wenn es regnet', 'in_progress', robin, 13 * DAY);
const wer1 = await version(wer, 1, 'Mix 1', robin, 6 * DAY, { freq: 280, seconds: 14, volume: 0.5 });
await shareWithListens(wer1, robin, [
  { name: 'Mara', openedAgo: 2 * DAY, seconds: 14, completed: true },
  { name: null, openedAgo: 5 * DAY, seconds: 6, completed: false },
]);
// More versions than keys in the mixer, of different lengths and loudness
const takes = await track(glas.id, 'Zehn Takes', 'in_progress', robin, 12 * DAY);
for (let n = 1; n <= 10; n++) {
  await version(takes, n, `Take ${n}`, robin, (11 - n) * DAY, { freq: 300 + n * 20, seconds: 4 + (n % 3), volume: 0.3 + n * 0.05 });
}

console.log('→ Alte Aufnahmen');
// Finished long ago: folded on "Tracks", hidden on the timeline
const archive = await project('Alte Aufnahmen', 'Archiv', robin, [[robin, 'owner']]);
await track(archive.id, 'Erstes Demo', 'released', robin, 200 * DAY);

console.log('\n✅ Fertig. Anmelden per Magic Link als robin@, jonas@, lena@, tom@ oder neu@example.test.');
process.exit(0);
