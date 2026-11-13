import { z } from 'zod';
import { and, asc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { AUDIO_MIME_BY_EXTENSION, IMPORT_KINDS, isAudioFile, isVersionable, MAX_FILE_SIZE, rightsOfRoles, type SourceEntry } from '@music-hub/shared';
import { importItems, imports, projectFiles, projectMembers, projects, stems, tracks, versionNotices, versions, type Database } from '@music-hub/db';
import { download, DropboxError, listFolder, session, type Session } from './dropbox.js';
import { fits, lockStorage, storageOf, takeUploadVolume } from './storage.js';
import { membershipOf } from './access.js';
import { resolveTrack } from './track-moves.js';
import { deleteObject, putObjectFile } from '../storage/s3.js';
import { enqueueAudioJob } from '../services/audio-jobs.js';
import { clearFailedStemMix, queueStemMix } from '../services/stem-mixes.js';
import { publish } from '../services/sse.js';

// What the scan keeps per file; the browser gets path, size and date only
export type ScannedEntry = SourceEntry & { rev: string; hash: string | null };

export const MAX_ATTEMPTS = 3;
const LEASE_MS = 10 * 60_000;

const rootNameOf = (path: string) => path.split('/').filter(Boolean).at(-1) ?? 'Dropbox';

// Looks at a folder and keeps what it found. null: more files than one import takes.
export async function scanFolder(db: Database, userId: string, s: Session, path: string) {
  const found = await listFolder(s, path, true);
  if (!found) return null;
  const rootLower = path.toLowerCase();
  const entries: ScannedEntry[] = [];
  for (const e of found) {
    if (e['.tag'] !== 'file' || e.is_downloadable === false || !e.path_lower || !e.rev) continue;
    const lower = e.path_lower.slice(rootLower.length).replace(/^\//, '');
    const display = e.path_display && e.path_display.length === e.path_lower.length ? e.path_display.slice(rootLower.length).replace(/^\//, '') : lower;
    // client_modified is when the file was saved on the computer; server_modified only when Dropbox got it
    entries.push({ path: display, size: e.size ?? 0, modified: e.client_modified ?? e.server_modified ?? new Date(0).toISOString(), rev: e.rev, hash: e.content_hash ?? null });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const [row] = await db.insert(imports).values({ userId, rootPath: path, entries }).returning({ id: imports.id });
  return { id: row.id, rootName: rootNameOf(path), entries };
}

// Entries whose content was imported before by the same person, with where it went
export async function earlierImports(db: Database, userId: string, entries: ScannedEntry[]) {
  const hashes = [...new Set(entries.map((e) => e.hash).filter((h): h is string => h !== null))];
  const earlier = new Map<string, { trackId: string | null; projectId: string }>();
  for (let i = 0; i < hashes.length; i += 1000) {
    const rows = await db
      .select({ hash: importItems.contentHash, trackId: importItems.trackId, projectId: importItems.projectId })
      .from(importItems)
      .innerJoin(imports, eq(imports.id, importItems.importId))
      // A rehearsal whose project was deleted, or whose song is in the trash, does not hold the file back
      .innerJoin(projects, and(eq(projects.id, importItems.projectId), eq(projects.isArchived, false)))
      .leftJoin(tracks, eq(tracks.id, importItems.trackId))
      .where(and(
        eq(imports.userId, userId),
        eq(importItems.status, 'done'),
        or(isNull(importItems.trackId), isNull(tracks.deletedAt)),
        inArray(importItems.contentHash, hashes.slice(i, i + 1000)),
      ));
    for (const row of rows) if (row.hash) earlier.set(row.hash, { trackId: row.trackId, projectId: row.projectId });
  }
  return earlier;
}

export const startSchema = z.object({
  projects: z.array(z.object({ name: z.string().trim().min(1).max(255) })).max(2000),
  tracks: z.array(z.object({ name: z.string().trim().min(1).max(255), project: z.number().int().nonnegative() })).max(20_000),
  items: z.array(z.object({
    entry: z.number().int().nonnegative(),
    kind: z.enum(IMPORT_KINDS),
    track: z.number().int().nonnegative().nullable(),
    project: z.number().int().nonnegative().nullable(),
    name: z.string().trim().max(255),
  })).max(20_000),
});
export type StartInput = z.infer<typeof startSchema>;

type StartResult =
  | { ok: true; items: number; duplicates: number }
  | { ok: false; error: 'not_found' | 'invalid_plan' | 'storage_full' | 'upload_volume' };

// Creates the projects and songs of the plan and queues its files for the worker
export async function startImport(db: Database, userId: string, importId: string, plan: StartInput): Promise<StartResult> {
  // Taken at once, so a second click or a retry never starts the same scan twice
  const [row] = await db.update(imports).set({ status: 'running' })
    .where(and(eq(imports.id, importId), eq(imports.userId, userId), eq(imports.status, 'scanned')))
    .returning();
  if (!row) return { ok: false, error: 'not_found' };
  const back = () => db.update(imports).set({ status: 'scanned' }).where(eq(imports.id, importId));
  try {
    const result = await start(db, userId, importId, row.entries as ScannedEntry[], plan);
    if (!result.ok) await back();
    return result;
  } catch (err) {
    await back();
    throw err;
  }
}

async function start(db: Database, userId: string, importId: string, entries: ScannedEntry[], plan: StartInput): Promise<StartResult> {

  const seen = new Set<number>();
  for (const item of plan.items) {
    if (item.entry >= entries.length || seen.has(item.entry)) return { ok: false, error: 'invalid_plan' };
    seen.add(item.entry);
    if (item.kind === 'skip') continue;
    // The same limits as the upload routes, whatever the browser sends
    const name = entries[item.entry].path;
    if (entries[item.entry].size > MAX_FILE_SIZE) return { ok: false, error: 'invalid_plan' };
    if (item.kind === 'version' && !isVersionable(name)) return { ok: false, error: 'invalid_plan' };
    if (item.kind === 'stem' && !isAudioFile(name, mimeOf(name))) return { ok: false, error: 'invalid_plan' };
    if (item.project === null || item.project >= plan.projects.length) return { ok: false, error: 'invalid_plan' };
    if (item.track !== null && (item.track >= plan.tracks.length || plan.tracks[item.track].project !== item.project)) return { ok: false, error: 'invalid_plan' };
    if (item.kind !== 'file' && item.track === null) return { ok: false, error: 'invalid_plan' };
  }
  if (plan.tracks.some((t) => t.project >= plan.projects.length)) return { ok: false, error: 'invalid_plan' };

  const earlier = await earlierImports(db, userId, entries);
  const wanted = plan.items.filter((item) => item.kind !== 'skip');
  const fresh = wanted.filter((item) => !earlier.has(entries[item.entry].hash ?? ''));

  // A song imported before gets the new files, in its project: so a second import adds the new bounce as the next version
  const trackTarget = new Map<number, { trackId: string; projectId: string }>();
  for (const item of wanted) {
    const before = earlier.get(entries[item.entry].hash ?? '');
    if (item.track === null || !before?.trackId || trackTarget.has(item.track)) continue;
    // A song merged into another one since gets the files there
    const track = await resolveTrack(db, before.trackId);
    if (track && (await membershipOf(db, track.projectId, userId))?.canUpload) trackTarget.set(item.track, { trackId: track.id, projectId: track.projectId });
  }
  const projectTarget = new Map<number, string>();
  for (const [index, target] of trackTarget) if (!projectTarget.has(plan.tracks[index].project)) projectTarget.set(plan.tracks[index].project, target.projectId);

  const total = fresh.reduce((sum, item) => sum + entries[item.entry].size, 0);
  if (!fits(await storageOf(db, userId), total)) return { ok: false, error: 'storage_full' };
  if (total > 0 && !(await takeUploadVolume(db, userId, total))) return { ok: false, error: 'upload_volume' };

  await db.transaction(async (tx) => {
    const projectIds = new Map(projectTarget);
    const trackIds = new Map([...trackTarget].map(([index, target]) => [index, target.trackId]));
    for (const item of fresh) {
      const project = item.project!;
      if (!projectIds.has(project)) {
        const [created] = await tx.insert(projects).values({ name: plan.projects[project].name, createdById: userId }).returning({ id: projects.id });
        await tx.insert(projectMembers).values({ projectId: created.id, userId, role: 'owner', ...rightsOfRoles(['owner']) });
        projectIds.set(project, created.id);
      }
      if (item.track !== null && !trackIds.has(item.track)) {
        // Mix the stems only for songs that bring no version of their own
        const ownVersion = fresh.some((other) => other.track === item.track && other.kind === 'version');
        const [created] = await tx.insert(tracks)
          .values({ name: plan.tracks[item.track].name, projectId: projectIds.get(project)!, createdById: userId, stemMix: !ownVersion })
          .returning({ id: tracks.id });
        trackIds.set(item.track, created.id);
      }
    }
    if (fresh.length > 0) {
      await tx.insert(importItems).values(fresh.map((item, position) => {
        const entry = entries[item.entry];
        return {
          importId,
          entry: item.entry,
          position,
          kind: item.kind as 'version' | 'stem' | 'file',
          name: (item.name || entry.path.split('/').at(-1) || 'Audio').slice(0, 255),
          // A song imported before keeps its project, even if the folder now sits elsewhere
          projectId: (item.track !== null && trackTarget.get(item.track)?.projectId) || projectIds.get(item.project!)!,
          trackId: item.track === null ? null : trackIds.get(item.track)!,
          fileName: safeFileName(entry.path.split('/').at(-1) ?? 'file'),
          rev: entry.rev,
          fileSize: entry.size,
          contentHash: entry.hash,
        };
      }));
    }
    await tx.update(imports)
      // The items carry what the worker needs; the list of everything in the folder is not kept
      .set({ status: fresh.length > 0 ? 'running' : 'done', entries: [], startedAt: new Date(), ...(fresh.length === 0 && { finishedAt: new Date() }) })
      .where(eq(imports.id, importId));
  });
  return { ok: true, items: fresh.length, duplicates: wanted.length - fresh.length };
}

// Bucket keys take the name as it is, only without slashes and control characters
const safeFileName = (name: string) => name.replace(/[/\\\p{Cc}]/gu, '_').slice(-255) || 'file';

const extensionOf = (name: string) => /\.[^.]+$/.exec(name)?.[0].toLowerCase() ?? '';
const OTHER_MIME: Record<string, string> = {
  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.mid': 'audio/midi', '.midi': 'audio/midi',
};
export function mimeOf(name: string) {
  const ext = extensionOf(name);
  return (AUDIO_MIME_BY_EXTENSION as Record<string, string>)[ext] ?? OTHER_MIME[ext] ?? 'application/octet-stream';
}

type Item = typeof importItems.$inferSelect;

async function claim(db: Database): Promise<(Item & { userId: string }) | null> {
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE import_items SET leased_until = now() + ${`${LEASE_MS} milliseconds`}::interval, attempts = attempts + 1
    WHERE id = (
      SELECT i.id FROM import_items i JOIN imports m ON m.id = i.import_id
      WHERE i.status = 'pending' AND m.status = 'running' AND (i.leased_until IS NULL OR i.leased_until < now())
        -- Versions get their numbers in order: one waiting for a retry holds back the later ones of its song
        AND NOT (i.kind = 'version' AND EXISTS (
          SELECT 1 FROM import_items e
          WHERE e.import_id = i.import_id AND e.track_id = i.track_id AND e.kind = 'version' AND e.status = 'pending' AND e.position < i.position
        ))
      ORDER BY m.created_at, i.position
      LIMIT 1 FOR UPDATE OF i SKIP LOCKED
    )
    RETURNING id
  `);
  const id = rows[0]?.id;
  if (!id) return null;
  const [item] = await db.select({ item: importItems, userId: imports.userId }).from(importItems)
    .innerJoin(imports, eq(imports.id, importItems.importId)).where(eq(importItems.id, id)).limit(1);
  return item ? { ...item.item, userId: item.userId } : null;
}

async function finish(db: Database, importId: string) {
  await db.execute(sql`
    UPDATE imports SET status = 'done', finished_at = now()
    WHERE id = ${importId} AND status = 'running'
      AND NOT EXISTS (SELECT 1 FROM import_items WHERE import_id = ${importId} AND status = 'pending')
  `);
}

async function fail(db: Database, item: Item, error: string, final: boolean) {
  await db.update(importItems)
    .set(final || item.attempts >= MAX_ATTEMPTS
      ? { status: 'failed', error, leasedUntil: null, finishedAt: new Date() }
      // Back in a minute
      : { error, leasedUntil: sql`now() + interval '1 minute'` })
    .where(eq(importItems.id, item.id));
  await finish(db, item.importId);
}

// Downloads to a file while hashing, so large WAVs never sit in memory
async function fetchToFile(s: Session, item: Item, path: string, signal: AbortSignal) {
  const body = await download(s, item.rev, signal);
  const hasher = new Bun.CryptoHasher('sha256');
  let bytes = 0;
  const hashing = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      hasher.update(chunk);
      bytes += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  await body.pipeThrough(hashing, { signal }).pipeTo(Writable.toWeb(createWriteStream(path)), { signal });
  return { bytes, sha256: hasher.digest('hex') };
}

// One file from Dropbox into its project; false when there is nothing to do
export async function processNextImportItem(db: Database, signal: AbortSignal): Promise<boolean> {
  const item = await claim(db);
  if (!item) return false;
  let directory: string | null = null;
  let key: string | null = null;
  try {
    const s = await session(db, item.userId);
    if (!s) {
      await fail(db, item, 'disconnected', true);
      return true;
    }
    directory = await mkdtemp(join(tmpdir(), 'musichub-import-'));
    const path = join(directory, 'file');
    const { bytes, sha256 } = await fetchToFile(s, item, path, signal);
    if (bytes !== item.fileSize) throw new Error(`Got ${bytes} bytes, expected ${item.fileSize}`);

    const mimeType = mimeOf(item.fileName);
    const folder = item.kind === 'file' && !isAudioFile(item.fileName, mimeType) ? 'file' : 'original';
    key = `projects/${item.projectId}/uploads/${crypto.randomUUID()}/${folder}/${item.fileName}`;
    await putObjectFile(key, path, mimeType);
    signal.throwIfAborted();

    const result = await register(db, item, key, mimeType, sha256);
    const stored = key;
    // Registered: from here on the object belongs to a version, stem or file and must stay
    if (typeof result === 'object') key = null;
    if (result === 'gone') {
      await deleteObject(stored).catch(() => {});
      await fail(db, item, 'target_gone', true);
    } else if (result === 'storage_full') {
      await deleteObject(stored).catch(() => {});
      await fail(db, item, 'storage_full', true);
    } else {
      if (result.versionId && item.trackId) {
        // As queueVersionNotice in lib/notices.ts, which the worker must not import: it pulls in SMTP
        await db.insert(versionNotices).values({ projectId: item.projectId, actorId: item.userId, versionId: result.versionId });
        publish(db, item.trackId, { type: 'version:new', data: { versionId: result.versionId, versionNumber: result.versionNumber, trackId: item.trackId } });
      }
      await finish(db, item.importId);
    }
  } catch (err) {
    if (key) await deleteObject(key).catch(() => {});
    if (signal.aborted) {
      // Shutting down: someone else takes it over, without the attempt counting
      await db.update(importItems).set({ leasedUntil: null, attempts: sql`greatest(${importItems.attempts} - 1, 0)` }).where(eq(importItems.id, item.id));
      return true;
    }
    const gone = err instanceof DropboxError && (err.gone || err.unauthorized);
    console.error(`[Import] Item ${item.id} failed:`, err instanceof DropboxError ? err.message : err);
    await fail(db, item, err instanceof DropboxError ? err.summary.slice(0, 200) : 'failed', gone);
    if (!gone) throw err;
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
  return true;
}

// The same rows the upload routes write, under the uploader's storage lock
async function register(db: Database, item: Item & { userId: string }, fileKey: string, mimeType: string, sha256: string) {
  return db.transaction(async (tx) => {
    await lockStorage(tx, item.userId);
    const membership = await membershipOf(tx, item.projectId, item.userId);
    if (!membership?.canUpload) return 'gone' as const;
    if (item.trackId) {
      const [track] = await tx.select({ id: tracks.id }).from(tracks).where(and(eq(tracks.id, item.trackId), isNull(tracks.deletedAt))).for('update');
      if (!track) return 'gone' as const;
    }
    if (!fits(await storageOf(tx, item.userId), item.fileSize)) return 'storage_full' as const;
    const common = { originalFileName: item.fileName, mimeType, fileSize: item.fileSize, createdById: item.userId };
    let versionId: string | null = null;
    let versionNumber = 0;
    if (item.kind === 'version') {
      const [latest] = await tx.select({ max: sql<number>`coalesce(max(${versions.versionNumber}), 0)` }).from(versions).where(eq(versions.trackId, item.trackId!));
      versionNumber = (latest?.max ?? 0) + 1;
      const [version] = await tx.insert(versions).values({
        ...common, trackId: item.trackId!, versionNumber, label: item.name.slice(0, 100), status: 'uploaded', originalFileKey: fileKey, sha256,
      }).returning({ id: versions.id });
      versionId = version.id;
      await enqueueAudioJob(tx, version.id);
      await clearFailedStemMix(tx, item.trackId!);
    } else if (item.kind === 'stem') {
      await tx.insert(stems).values({ ...common, trackId: item.trackId!, name: item.name, fileKey, sha256 });
      await queueStemMix(tx, item.trackId!, item.userId);
    } else {
      await tx.insert(projectFiles).values({ ...common, projectId: item.projectId, trackId: item.trackId, fileKey });
    }
    await tx.update(importItems).set({ status: 'done', leasedUntil: null, error: null, finishedAt: new Date() }).where(eq(importItems.id, item.id));
    return { versionId, versionNumber };
  });
}

// For the progress view: the import and how far its files are
export async function importStatus(db: Database, userId: string, importId: string) {
  const [row] = await db.select({ id: imports.id, status: imports.status, rootPath: imports.rootPath, createdAt: imports.createdAt, finishedAt: imports.finishedAt })
    .from(imports).where(and(eq(imports.id, importId), eq(imports.userId, userId))).limit(1);
  if (!row) return null;
  const items = await db.select({
    id: importItems.id, kind: importItems.kind, name: importItems.name, status: importItems.status, error: importItems.error,
    fileSize: importItems.fileSize, projectId: importItems.projectId, trackId: importItems.trackId,
    projectName: projects.name, trackName: tracks.name,
  }).from(importItems)
    .innerJoin(projects, eq(projects.id, importItems.projectId))
    .leftJoin(tracks, eq(tracks.id, importItems.trackId))
    .where(eq(importItems.importId, importId))
    .orderBy(asc(importItems.position));
  return { ...row, rootName: rootNameOf(row.rootPath), items };
}

export async function cancelImport(db: Database, userId: string, importId: string) {
  const [row] = await db.update(imports).set({ status: 'cancelled', finishedAt: new Date() })
    .where(and(eq(imports.id, importId), eq(imports.userId, userId), inArray(imports.status, ['scanned', 'running'])))
    .returning({ id: imports.id });
  if (!row) return false;
  // What is already in the projects stays; files still waiting are dropped
  // The file the worker is copying right now still lands and is counted
  await db.delete(importItems).where(and(
    eq(importItems.importId, importId),
    eq(importItems.status, 'pending'),
    or(isNull(importItems.leasedUntil), lt(importItems.leasedUntil, sql`now()`)),
  ));
  return true;
}

// Looking at Dropbox without an import keeps nothing for long
export async function deleteStaleScans(db: Database) {
  await db.delete(imports).where(and(eq(imports.status, 'scanned'), sql`${imports.createdAt} < now() - interval '1 day'`));
}

