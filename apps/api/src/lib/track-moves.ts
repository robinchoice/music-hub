import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import {
  comments,
  deliveries,
  deliveryTracks,
  guestNotes,
  importItems,
  openTracks,
  projectFiles,
  projectMembers,
  shareLinks,
  stemMixJobs,
  stemMixUploads,
  stemRevisions,
  stems,
  tracks,
  users,
  versionNotices,
  versions,
  type Database,
} from '@music-hub/db';
import { songKey } from '@music-hub/shared';
import type { Context } from 'hono';
import { membershipOf } from './access.js';
import { t } from './i18n.js';
import { queueStemMix } from '../services/stem-mixes.js';

// Moving tracks between projects, merging two tracks and moving a version into another track.
// Rows change, files don't: every key in the bucket stays where it is (keysInUse looks at rows, not paths),
// and storage stays with whoever uploaded (uploadedFiles counts by uploader, not by project).

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Reader = Pick<Database, 'select' | 'selectDistinct'>;
type Track = typeof tracks.$inferSelect;

export type Problem =
  | { code: 'track_open' }
  | { code: 'in_delivery' }
  | { code: 'importing' }
  | { code: 'remix' }
  | { code: 'uploaders_missing'; names: string[] };

export type Refusal = { status: 403 | 404 } | { status: 409; problems: Problem[] };

// Moving and merging hand a track and everything below it on, so it takes the owner of both projects.
// An archived project takes no new tracks and gives none away.
async function ownsLive(db: Reader, projectId: string, userId: string) {
  const m = await membershipOf(db, projectId, userId);
  return !!m && m.canUpload && (m.role === 'owner' || m.extraRoles.includes('owner'));
}

// A live track, or the one a merged track went into (its old id keeps leading there for clients that stored it)
export async function resolveTrack(db: Reader, trackId: string): Promise<Track | undefined> {
  let id = trackId;
  const seen = new Set<string>();
  while (!seen.has(id)) {
    seen.add(id);
    const [track] = await db.select().from(tracks).where(eq(tracks.id, id)).limit(1);
    if (!track) return undefined;
    if (!track.deletedAt) return track;
    if (!track.mergedIntoId) return undefined;
    id = track.mergedIntoId;
  }
  return undefined;
}

// Everybody who uploaded something below the tracks, in the trash included: they keep paying for it
async function uploadersOf(db: Reader, trackIds: string[]) {
  const [v, s, r, f] = await Promise.all([
    db.selectDistinct({ id: versions.createdById }).from(versions).where(inArray(versions.trackId, trackIds)),
    db.selectDistinct({ id: stems.createdById }).from(stems).where(inArray(stems.trackId, trackIds)),
    db
      .selectDistinct({ id: stemRevisions.createdById })
      .from(stemRevisions)
      .innerJoin(stems, eq(stems.id, stemRevisions.stemId))
      .where(inArray(stems.trackId, trackIds)),
    db.selectDistinct({ id: projectFiles.createdById }).from(projectFiles).where(inArray(projectFiles.trackId, trackIds)),
  ]);
  return [...new Set([...v, ...s, ...r, ...f].map((row) => row.id))];
}

// What keeps tracks where they are. uploaders: who uploaded what would move; those who reach it in the
// project it comes from have to reach it in the project it goes to as well.
async function problemsOf(
  db: Reader,
  trackIds: string[],
  move: { uploaders: string[]; from: string; to: string },
): Promise<Problem[]> {
  const problems: Problem[] = [];
  const [open, delivered, importing] = !trackIds.length ? [[], [], []] : await Promise.all([
    db.select({ id: openTracks.trackId }).from(openTracks).where(inArray(openTracks.trackId, trackIds)).limit(1),
    db
      .select({ id: deliveryTracks.trackId })
      .from(deliveryTracks)
      .innerJoin(deliveries, eq(deliveries.id, deliveryTracks.deliveryId))
      .where(and(inArray(deliveryTracks.trackId, trackIds), ne(deliveries.status, 'cancelled')))
      .limit(1),
    db
      .select({ id: importItems.id })
      .from(importItems)
      .where(and(inArray(importItems.trackId, trackIds), eq(importItems.status, 'pending')))
      .limit(1),
  ]);
  // The public page names artist and project, and an order's paywall and rounds belong to its project link
  if (open.length) problems.push({ code: 'track_open' });
  if (delivered.length) problems.push({ code: 'in_delivery' });
  if (importing.length) problems.push({ code: 'importing' });

  if (move.from !== move.to && move.uploaders.length) {
    const memberships = await db
      .select({ id: projectMembers.userId, projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(and(inArray(projectMembers.projectId, [move.from, move.to]), inArray(projectMembers.userId, move.uploaders)));
    const inProject = (projectId: string) => new Set(memberships.filter((m) => m.projectId === projectId).map((m) => m.id));
    const [before, after] = [inProject(move.from), inProject(move.to)];
    const missing = move.uploaders.filter((id) => before.has(id) && !after.has(id));
    if (missing.length) {
      const names = await db.select({ name: users.name }).from(users).where(inArray(users.id, missing)).orderBy(asc(users.name));
      problems.push({ code: 'uploaders_missing', names: names.map((n) => n.name) });
    }
  }
  return problems;
}

const lockTracks = async (tx: Tx, ids: string[]) => {
  // Always in the same order, so two merges of the same pair can't wait for each other
  for (const id of [...ids].sort()) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'open:' + id}))`);
  await tx.select({ id: tracks.id }).from(tracks).where(inArray(tracks.id, ids)).orderBy(asc(tracks.id)).for('no key update');
};

// After waiting for another move, the original project and live state must still hold.
async function unchangedTracks(tx: Tx, before: Track[]) {
  const rows = await tx.select().from(tracks).where(inArray(tracks.id, before.map((t) => t.id)));
  return before.every((t) => rows.some((r) => r.id === t.id && !r.deletedAt && r.projectId === t.projectId));
}

const nextSortOrder = async (tx: Tx, projectId: string) => {
  const [row] = await tx
    .select({ max: sql<number>`coalesce(max(${tracks.sortOrder}), 0)` })
    .from(tracks)
    .where(eq(tracks.projectId, projectId));
  return Number(row?.max ?? 0) + 1;
};

const nextVersionNumber = async (tx: Reader, trackId: string) => {
  // Versions in the trash keep their numbers, so they count too
  const [row] = await tx
    .select({ max: sql<number>`coalesce(max(${versions.versionNumber}), 0)` })
    .from(versions)
    .where(eq(versions.trackId, trackId));
  return Number(row?.max ?? 0) + 1;
};

// --- Moving a track into another project ---

export async function moveTrack(
  db: Database,
  trackId: string,
  input: { projectId: string; section?: string | null | undefined; dryRun?: boolean | undefined },
  userId: string,
): Promise<{ ok: true; track: Track | null } | ({ ok: false } & Refusal)> {
  const [track] = await db.select().from(tracks).where(and(eq(tracks.id, trackId), isNull(tracks.deletedAt))).limit(1);
  if (!track || !(await membershipOf(db, track.projectId, userId))) return { ok: false, status: 404 };
  if (!(await membershipOf(db, input.projectId, userId))) return { ok: false, status: 404 };
  if (!(await ownsLive(db, track.projectId, userId)) || !(await ownsLive(db, input.projectId, userId))) return { ok: false, status: 403 };
  const section = input.section === undefined ? track.section : input.section || null;
  const sameProject = input.projectId === track.projectId;

  const check = async (r: Reader) =>
    sameProject ? [] : problemsOf(r, [track.id], { uploaders: await uploadersOf(r, [track.id]), from: track.projectId, to: input.projectId });
  const problems = await check(db);
  if (problems.length) return { ok: false, status: 409, problems };
  if (input.dryRun) return { ok: true, track: null };

  return db.transaction(async (tx) => {
    await lockTracks(tx, [track.id]);
    if (!(await unchangedTracks(tx, [track]))) return { ok: false as const, status: 409 as const, problems: [] };
    // Checked again under the lock: an order or an opening may have come in meanwhile
    const late = await check(tx);
    if (late.length) return { ok: false as const, status: 409 as const, problems: late };

    const [moved] = await tx
      .update(tracks)
      .set({
        projectId: input.projectId,
        section,
        ...(!sameProject && { sortOrder: await nextSortOrder(tx, input.projectId) }),
        updatedAt: new Date(),
      })
      .where(eq(tracks.id, track.id))
      .returning();
    if (!sameProject) {
      await tx.update(projectFiles).set({ projectId: input.projectId, reference: false }).where(eq(projectFiles.trackId, track.id));
      const ids = tx.select({ id: versions.id }).from(versions).where(eq(versions.trackId, track.id));
      await tx.update(versionNotices).set({ projectId: input.projectId }).where(inArray(versionNotices.versionId, ids));
      await tx.update(tracks).set({ projectId: input.projectId }).where(eq(tracks.mergedIntoId, track.id));
    }
    return { ok: true as const, track: moved };
  });
}

// --- Merging a track into another one ---

export type MergePreview = {
  // Each version of the merged track with its number before and after, duplicateOf: the number of the
  // identical version the target already has (it goes into the trash, its comments move there)
  versions: { id: string; from: number; to: number; duplicateOf: number | null }[];
  stems: { added: number; revised: number; duplicates: number };
  files: number;
};

const stemDate = (s: { revisedAt: Date | null; createdAt: Date }) => s.revisedAt ?? s.createdAt;
const stemName = (name: string) => name.trim().toLowerCase();

async function mergePlan(db: Reader, source: Track, target: Track) {
  const [targetVersions, sourceVersions, targetStems, sourceStems, files] = await Promise.all([
    db.select({ id: versions.id, versionNumber: versions.versionNumber, sha256: versions.sha256, deletedAt: versions.deletedAt }).from(versions).where(eq(versions.trackId, target.id)),
    db.select({ id: versions.id, versionNumber: versions.versionNumber, sha256: versions.sha256, deletedAt: versions.deletedAt }).from(versions).where(eq(versions.trackId, source.id)).orderBy(asc(versions.versionNumber), asc(versions.createdAt)),
    db.select().from(stems).where(and(eq(stems.trackId, target.id), isNull(stems.deletedAt))),
    db.select().from(stems).where(eq(stems.trackId, source.id)),
    db.select({ id: projectFiles.id }).from(projectFiles).where(eq(projectFiles.trackId, source.id)),
  ]);

  const base = Math.max(0, ...targetVersions.map((v) => v.versionNumber));
  const twinOf = new Map(targetVersions.filter((v) => !v.deletedAt && v.sha256).map((v) => [v.sha256!, v]));
  const versionMoves = sourceVersions.map((v, i) => {
    const twin = !v.deletedAt && v.sha256 ? twinOf.get(v.sha256) : undefined;
    return { id: v.id, from: v.versionNumber, to: base + i + 1, twinId: twin?.id ?? null, duplicateOf: twin?.versionNumber ?? null };
  });

  const byName = new Map(targetStems.map((s) => [stemName(s.name), s]));
  const stemMoves = sourceStems.map((s) => {
    const other = s.deletedAt ? undefined : byName.get(stemName(s.name));
    if (!other) return { stem: s, into: null, kind: 'added' as const };
    if (s.sha256 && s.sha256 === other.sha256) return { stem: s, into: other, kind: 'duplicate' as const };
    return { stem: s, into: other, kind: 'revised' as const };
  });

  const preview: MergePreview = {
    versions: versionMoves.map(({ id, from, to, duplicateOf }) => ({ id, from, to, duplicateOf })),
    stems: {
      added: stemMoves.filter((m) => m.kind === 'added' && !m.stem.deletedAt).length,
      revised: stemMoves.filter((m) => m.kind === 'revised').length,
      duplicates: stemMoves.filter((m) => m.kind === 'duplicate').length,
    },
    files: files.length,
  };
  return { preview, versionMoves, stemMoves };
}

export async function mergeTracks(
  db: Database,
  sourceId: string,
  targetId: string,
  userId: string,
  dryRun = false,
): Promise<{ ok: true; preview: MergePreview; track: Track | null } | ({ ok: false } & Refusal)> {
  const [source] = await db.select().from(tracks).where(and(eq(tracks.id, sourceId), isNull(tracks.deletedAt))).limit(1);
  const [target] = await db.select().from(tracks).where(and(eq(tracks.id, targetId), isNull(tracks.deletedAt))).limit(1);
  if (!source || !target) return { ok: false, status: 404 };
  if (!(await membershipOf(db, source.projectId, userId)) || !(await membershipOf(db, target.projectId, userId))) return { ok: false, status: 404 };
  if (source.id === target.id) return { ok: false, status: 409, problems: [] };
  if (!(await ownsLive(db, source.projectId, userId)) || !(await ownsLive(db, target.projectId, userId))) return { ok: false, status: 403 };

  const check = async (r: Reader) => {
    const problems = await problemsOf(r, [source.id, target.id], { uploaders: await uploadersOf(r, [source.id]), from: source.projectId, to: target.projectId });
    // A remix carries the license and credit of its original; only remixes of the same original fit together
    if ((source.forkedFromId || target.forkedFromId) && (source.forkedFromId !== target.forkedFromId || source.license !== target.license)) {
      problems.push({ code: 'remix' });
    }
    return problems;
  };
  const problems = await check(db);
  if (problems.length) return { ok: false, status: 409, problems };
  if (dryRun) return { ok: true, preview: (await mergePlan(db, source, target)).preview, track: null };

  return db.transaction(async (tx) => {
    await lockTracks(tx, [source.id, target.id]);
    if (!(await unchangedTracks(tx, [source, target]))) return { ok: false as const, status: 409 as const, problems: [] };
    const late = await check(tx);
    if (late.length) return { ok: false as const, status: 409 as const, problems: late };
    const { preview, versionMoves, stemMoves } = await mergePlan(tx, source, target);
    const now = new Date();

    // Versions: appended after the target's own numbers, which stay as they are
    for (const v of versionMoves) {
      await tx
        .update(versions)
        .set({ trackId: target.id, versionNumber: v.to, ...(v.twinId && { deletedAt: now, deletedById: userId }) })
        .where(eq(versions.id, v.id));
      if (v.twinId) {
        // The same file is there already: its comments and the links fixed on it go to the twin
        await tx.update(comments).set({ versionId: v.twinId }).where(eq(comments.versionId, v.id));
        await tx.update(shareLinks).set({ versionId: v.twinId }).where(and(eq(shareLinks.versionId, v.id), eq(shareLinks.follows, 'version')));
      }
    }
    if (source.projectId !== target.projectId && versionMoves.length) {
      await tx.update(versionNotices).set({ projectId: target.projectId }).where(inArray(versionNotices.versionId, versionMoves.map((v) => v.id)));
    }

    // Stems: one of the same name takes the other's files into its history, the newer file stays current
    for (const m of stemMoves) {
      if (m.into && m.kind === 'duplicate') {
        await tx.update(stemRevisions).set({ stemId: m.into.id }).where(eq(stemRevisions.stemId, m.stem.id));
      }
      if (!m.into || m.kind === 'duplicate') {
        await tx
          .update(stems)
          .set({ trackId: target.id, ...(m.kind === 'duplicate' && { deletedAt: now, deletedById: userId }) })
          .where(eq(stems.id, m.stem.id));
        continue;
      }
      const [current] = await tx.select().from(stems).where(eq(stems.id, m.into.id));
      const incoming = m.stem;
      await tx.update(stemRevisions).set({ stemId: current.id }).where(eq(stemRevisions.stemId, incoming.id));
      const [older, newer] = stemDate(incoming) > stemDate(current) ? [current, incoming] : [incoming, current];
      await tx.insert(stemRevisions).values({
        stemId: current.id,
        originalFileName: older.originalFileName,
        mimeType: older.mimeType,
        fileSize: older.fileSize,
        fileKey: older.fileKey,
        sha256: older.sha256,
        forked: older.forked,
        guestName: older.guestName,
        createdById: older.createdById,
        createdAt: stemDate(older),
        replacedAt: stemDate(newer),
      });
      if (newer === incoming) {
        await tx
          .update(stems)
          .set({
            originalFileName: incoming.originalFileName,
            mimeType: incoming.mimeType,
            fileSize: incoming.fileSize,
            fileKey: incoming.fileKey,
            sha256: incoming.sha256,
            forked: incoming.forked,
            guestName: incoming.guestName,
            createdById: incoming.createdById,
            revisedAt: stemDate(incoming),
          })
          .where(eq(stems.id, current.id));
      }
      // Its files live on in the target's stem now; in one statement with keysInUse's view, nothing turns orphan
      await tx.delete(stems).where(eq(stems.id, incoming.id));
    }

    await tx.update(projectFiles).set({ trackId: target.id, projectId: target.projectId, ...(source.projectId !== target.projectId && { reference: false }) }).where(eq(projectFiles.trackId, source.id));
    await tx.update(guestNotes).set({ trackId: target.id }).where(eq(guestNotes.trackId, source.id));
    await tx.delete(stemMixJobs).where(eq(stemMixJobs.trackId, source.id));
    await tx.delete(stemMixUploads).where(eq(stemMixUploads.trackId, source.id));
    if (stemMoves.some((m) => !m.stem.deletedAt)) await queueStemMix(tx, target.id, userId);
    // Older aliases point straight to the final track, even after another merge.
    await tx.update(tracks).set({ mergedIntoId: target.id, projectId: target.projectId }).where(eq(tracks.mergedIntoId, source.id));

    const takeCover = !target.coverImageUrl && source.coverImageUrl;
    const [merged] = await tx
      .update(tracks)
      .set({ updatedAt: now, ...(takeCover && { coverImageUrl: source.coverImageUrl }) })
      .where(eq(tracks.id, target.id))
      .returning();
    await tx
      .update(tracks)
      .set({ deletedAt: now, deletedById: userId, mergedIntoId: target.id, projectId: target.projectId, updatedAt: now, ...(takeCover && { coverImageUrl: null }) })
      .where(eq(tracks.id, source.id));
    return { ok: true as const, preview, track: merged };
  });
}

// --- Moving one version into another track, or into a track of its own ---

type Version = typeof versions.$inferSelect;

async function moveVersionTx(tx: Tx, version: Version, from: Track, to: Track) {
  // Links that follow the old track stay with it, as long as it has another version to show
  const [other] = await tx
    .select({ id: versions.id })
    .from(versions)
    .where(and(eq(versions.trackId, from.id), ne(versions.id, version.id)))
    .orderBy(desc(versions.versionNumber))
    .limit(1);
  if (other) {
    await tx.update(shareLinks).set({ versionId: other.id }).where(and(eq(shareLinks.versionId, version.id), ne(shareLinks.follows, 'version')));
  }
  // A branch doesn't reach across tracks
  await tx.update(versions).set({ parentVersionId: null }).where(eq(versions.parentVersionId, version.id));
  const [moved] = await tx
    .update(versions)
    .set({ trackId: to.id, versionNumber: await nextVersionNumber(tx, to.id), parentVersionId: null })
    .where(eq(versions.id, version.id))
    .returning();
  if (from.projectId !== to.projectId) {
    await tx.update(versionNotices).set({ projectId: to.projectId }).where(eq(versionNotices.versionId, version.id));
  }
  await tx.update(tracks).set({ updatedAt: new Date() }).where(inArray(tracks.id, [from.id, to.id]));
  return moved;
}

async function versionWithTrack(db: Reader, versionId: string) {
  const [row] = await db
    .select({ version: versions, track: tracks })
    .from(versions)
    .innerJoin(tracks, eq(tracks.id, versions.trackId))
    .where(and(eq(versions.id, versionId), isNull(versions.deletedAt), isNull(tracks.deletedAt)))
    .limit(1);
  return row;
}

async function versionProblems(db: Reader, version: Version, from: Track, to: Track) {
  // Only the version's own uploader has to reach it afterwards
  const problems = await problemsOf(db, [from.id, to.id], { uploaders: [version.createdById], from: from.projectId, to: to.projectId });
  if ((from.forkedFromId || to.forkedFromId) && (from.forkedFromId !== to.forkedFromId || from.license !== to.license)) problems.push({ code: 'remix' });
  return problems;
}

export async function moveVersion(
  db: Database,
  versionId: string,
  input: { trackId: string; dryRun?: boolean | undefined },
  userId: string,
): Promise<{ ok: true; version: Version | null } | ({ ok: false } & Refusal)> {
  const found = await versionWithTrack(db, versionId);
  const [to] = await db.select().from(tracks).where(and(eq(tracks.id, input.trackId), isNull(tracks.deletedAt))).limit(1);
  if (!found || !to) return { ok: false, status: 404 };
  if (!(await membershipOf(db, found.track.projectId, userId)) || !(await membershipOf(db, to.projectId, userId))) return { ok: false, status: 404 };
  if (to.id === found.track.id) return { ok: false, status: 409, problems: [] };
  if (!(await ownsLive(db, found.track.projectId, userId)) || !(await ownsLive(db, to.projectId, userId))) return { ok: false, status: 403 };
  const problems = await versionProblems(db, found.version, found.track, to);
  if (problems.length) return { ok: false, status: 409, problems };
  if (input.dryRun) return { ok: true, version: null };

  return db.transaction(async (tx) => {
    await lockTracks(tx, [found.track.id, to.id]);
    const current = await versionWithTrack(tx, versionId);
    if (!current || current.track.id !== found.track.id || !(await unchangedTracks(tx, [found.track, to]))) return { ok: false as const, status: 409 as const, problems: [] };
    const late = await versionProblems(tx, found.version, found.track, to);
    if (late.length) return { ok: false as const, status: 409 as const, problems: late };
    return { ok: true as const, version: await moveVersionTx(tx, found.version, found.track, to) };
  });
}

// The version leaves its track and starts a new one next to it, in the same project and section
export async function splitVersion(
  db: Database,
  versionId: string,
  name: string | undefined,
  userId: string,
): Promise<{ ok: true; track: Track; version: Version } | ({ ok: false } & Refusal)> {
  const found = await versionWithTrack(db, versionId);
  if (!found || !(await membershipOf(db, found.track.projectId, userId))) return { ok: false, status: 404 };
  if (!(await ownsLive(db, found.track.projectId, userId))) return { ok: false, status: 403 };
  const problems = await problemsOf(db, [found.track.id], { uploaders: [], from: found.track.projectId, to: found.track.projectId });
  if (problems.length) return { ok: false, status: 409, problems };

  return db.transaction(async (tx) => {
    await lockTracks(tx, [found.track.id]);
    const current = await versionWithTrack(tx, versionId);
    if (!current || current.track.id !== found.track.id || !(await unchangedTracks(tx, [found.track]))) return { ok: false as const, status: 409 as const, problems: [] };
    const late = await problemsOf(tx, [found.track.id], { uploaders: [], from: found.track.projectId, to: found.track.projectId });
    if (late.length) return { ok: false as const, status: 409 as const, problems: late };
    const [track] = await tx
      .insert(tracks)
      .values({
        projectId: found.track.projectId,
        name: name ?? `${found.track.name} (V${found.version.versionNumber})`.slice(0, 255),
        section: found.track.section,
        sortOrder: found.track.sortOrder,
        status: found.track.status,
        stemMix: false,
        forkedFromId: found.track.forkedFromId,
        license: found.track.license,
        credit: found.track.credit,
        createdById: userId,
      })
      .returning();
    const version = await moveVersionTx(tx, found.version, found.track, track);
    return { ok: true as const, track, version };
  });
}

// --- Possible duplicates among the user's own projects: similar names or the same file ---

export async function duplicateTracks(db: Reader, userId: string, projectId?: string) {
  const owned = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(and(eq(projectMembers.userId, userId), sql`(${projectMembers.role} = 'owner' OR 'owner' = ANY(${projectMembers.extraRoles}))`));
  const projectIds = owned.map((o) => o.projectId).filter((id) => !projectId || id === projectId);
  if (!projectIds.length) return [];

  const list = await db
    .select({
      id: tracks.id,
      name: tracks.name,
      section: tracks.section,
      projectId: tracks.projectId,
      updatedAt: tracks.updatedAt,
      versionCount: sql<number>`(select count(*)::int from versions v where v.track_id = ${tracks.id} and v.deleted_at is null)`,
    })
    .from(tracks)
    .where(and(inArray(tracks.projectId, projectIds), isNull(tracks.deletedAt)))
    .orderBy(asc(tracks.createdAt));
  if (!list.length) return [];
  const files = await db
    .select({ trackId: versions.trackId, sha256: versions.sha256 })
    .from(versions)
    .where(and(inArray(versions.trackId, list.map((t) => t.id)), isNull(versions.deletedAt), isNotNull(versions.sha256)));

  // Union-find over two kinds of evidence: the same song name, the same file
  const parent = new Map(list.map((t) => [t.id, t.id]));
  const root = (id: string): string => (parent.get(id) === id ? id : root(parent.get(id)!));
  const join = (a: string, b: string) => parent.set(root(a), root(b));
  const reasons = new Map<string, Set<'name' | 'file'>>();
  const note = (a: string, b: string, why: 'name' | 'file') => {
    join(a, b);
    for (const id of [a, b]) reasons.set(id, (reasons.get(id) ?? new Set()).add(why));
  };
  const firstByKey = new Map<string, string>();
  for (const t of list) {
    const key = songKey(t.name);
    if (!key) continue;
    const first = firstByKey.get(key);
    if (first) note(first, t.id, 'name');
    else firstByKey.set(key, t.id);
  }
  const firstByFile = new Map<string, string>();
  for (const f of files) {
    const first = firstByFile.get(f.sha256!);
    if (first && first !== f.trackId) note(first, f.trackId, 'file');
    else if (!first) firstByFile.set(f.sha256!, f.trackId);
  }

  const groups = Map.groupBy(list.filter((t) => reasons.has(t.id)), (t) => root(t.id));
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => ({
      reasons: [...new Set(g.flatMap((t) => [...reasons.get(t.id)!]))].sort(),
      tracks: g,
    }));
}

// For a client that asks after a track it stored: where it lives now, through merges
export async function whereIsTrack(db: Reader, trackId: string, userId: string) {
  const track = await resolveTrack(db, trackId);
  if (!track || !(await membershipOf(db, track.projectId, userId))) return null;
  return track;
}


// The answer to a refused move: 403 and 404 as everywhere, 409 with each reason in the request's language
export function refuse(c: Context, r: Refusal) {
  if (r.status !== 409) return c.json({ error: r.status === 403 ? 'Forbidden' : 'Not found' }, r.status);
  const m = t(c).errors;
  const text = (p: Problem) =>
    p.code === 'track_open'
      ? m.moveTrackOpen
      : p.code === 'in_delivery'
        ? m.moveInDelivery
        : p.code === 'importing'
          ? m.moveImporting
          : p.code === 'remix'
            ? m.moveRemix
            : m.moveUploadersMissing(p.names);
  const problems = r.problems.map((p) => ({ ...p, error: text(p) }));
  return c.json({ error: problems.map((p) => p.error).join(' ') || m.moveSameTrack, problems }, 409);
}

// The id to use for a track a client asked for by id: a merged track's id leads to the track it went into,
// so plugins and pages that stored the old id keep uploading and listening there
export const liveTrackId = async (db: Reader, trackId: string) => (await resolveTrack(db, trackId))?.id ?? trackId;

// --- A file of the project: to another track or into another project ---

export async function updateFile(
  db: Database,
  fileId: string,
  input: { originalFileName?: string | undefined; trackId?: string | null | undefined; projectId?: string | undefined },
  userId: string,
): Promise<{ ok: true; file: typeof projectFiles.$inferSelect } | ({ ok: false } & Refusal)> {
  const [file] = await db.select().from(projectFiles).where(and(eq(projectFiles.id, fileId), isNull(projectFiles.deletedAt))).limit(1);
  const membership = file && (await membershipOf(db, file.projectId, userId));
  if (!file || !membership) return { ok: false, status: 404 };
  // Like deleting: the uploader or the owner, while the project takes changes
  if (!membership.canUpload || !(membership.role === 'owner' || file.createdById === userId)) return { ok: false, status: 403 };

  const projectId = input.projectId ?? file.projectId;
  if (projectId !== file.projectId) {
    if (!(await membershipOf(db, projectId, userId))) return { ok: false, status: 404 };
    if (!(await ownsLive(db, file.projectId, userId)) || !(await ownsLive(db, projectId, userId))) return { ok: false, status: 403 };
    const problems = await problemsOf(db, [], { uploaders: [file.createdById], from: file.projectId, to: projectId });
    if (problems.length) return { ok: false, status: 409, problems };
  }
  // Another project leaves the old track behind unless a track there is named
  const trackId = input.trackId !== undefined ? input.trackId : projectId === file.projectId ? file.trackId : null;
  if (trackId) {
    const [track] = await db
      .select({ id: tracks.id })
      .from(tracks)
      .where(and(eq(tracks.id, trackId), eq(tracks.projectId, projectId), isNull(tracks.deletedAt)))
      .limit(1);
    if (!track) return { ok: false, status: 404 };
  }

  const [updated] = await db
    .update(projectFiles)
    .set({ projectId, trackId, ...(projectId !== file.projectId && { reference: false }), ...(input.originalFileName && { originalFileName: input.originalFileName }) })
    .where(eq(projectFiles.id, file.id))
    .returning();
  return { ok: true, file: updated };
}
