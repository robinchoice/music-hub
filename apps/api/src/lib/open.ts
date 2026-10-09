import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { OPEN_LICENSES, OPEN_LICENSE_INFO, type OpenLicense } from '@music-hub/shared';
import {
  openConsents,
  openTracks,
  projectMembers,
  projects,
  stems,
  tracks,
  users,
  versions,
  type Database,
} from '@music-hub/db';
import { notBlocked } from './users.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Db = Database | Tx;

export const openUrl = (trackId: string) => `${process.env.APP_URL ?? ''}/offen/${trackId}`;

// A remix may only be opened under terms its original allows: share-alike stays share-alike,
// attribution can't become public domain
export function allowedLicenses(inherited: string | null): OpenLicense[] {
  if (inherited === 'cc-by-sa') return ['cc-by-sa'];
  if (inherited === 'cc-by') return ['cc-by-sa', 'cc-by'];
  return [...OPEN_LICENSES];
}

// The newest approved version is what opens
export async function approvedVersion(db: Db, trackId: string) {
  const [version] = await db
    .select()
    .from(versions)
    .where(and(eq(versions.trackId, trackId), eq(versions.status, 'approved'), isNull(versions.deletedAt)))
    .orderBy(desc(versions.versionNumber))
    .limit(1);
  return version;
}

// Everyone whose work goes public: who uploaded the stems and the version, and who asks to open it.
// Stems taken over from another open track are already licensed and need nobody's consent.
export async function contributorsOf(db: Db, trackId: string, versionId: string | null, requestedById: string | null) {
  const stemRows = await db
    .select({ userId: stems.createdById, count: sql<number>`count(*)::int` })
    .from(stems)
    .where(and(eq(stems.trackId, trackId), isNull(stems.deletedAt), eq(stems.forked, false)))
    .groupBy(stems.createdById);
  const counts = new Map(stemRows.map((r) => [r.userId, r.count]));

  const ids = new Set(counts.keys());
  if (versionId) {
    const [version] = await db.select({ createdById: versions.createdById }).from(versions).where(eq(versions.id, versionId));
    if (version) ids.add(version.createdById);
  }
  if (requestedById) ids.add(requestedById);
  if (!ids.size) return [];

  const people = await db
    .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
    .from(users)
    .where(inArray(users.id, [...ids]))
    .orderBy(asc(users.name));
  return people.map((p) => ({ ...p, stemCount: counts.get(p.id) ?? 0 }));
}

// The open state as the track page shows it, also before anyone asked to open the track
export async function openStateOf(db: Db, trackId: string) {
  const [track] = await db.select().from(tracks).where(eq(tracks.id, trackId));
  const [row] = await db.select().from(openTracks).where(eq(openTracks.trackId, trackId));
  const version = row ? null : await approvedVersion(db, trackId);
  const versionId = row?.versionId ?? version?.id ?? null;

  const consented = row
    ? new Set((await db.select({ userId: openConsents.userId }).from(openConsents).where(eq(openConsents.trackId, trackId))).map((c) => c.userId))
    : new Set<string>();
  const contributors = (await contributorsOf(db, trackId, versionId, row?.requestedById ?? null)).map((p) => ({
    ...p,
    consented: consented.has(p.id),
  }));

  return {
    license: (row?.license ?? null) as OpenLicense | null,
    openedAt: row?.openedAt ?? null,
    requestedById: row?.requestedById ?? null,
    versionId,
    allowedLicenses: allowedLicenses(track?.license ?? null),
    contributors,
  };
}

// Opens the track once everyone agreed. Returns whether it is open now.
async function openIfAgreed(tx: Tx, trackId: string) {
  const [row] = await tx.select().from(openTracks).where(eq(openTracks.trackId, trackId));
  if (!row) return false;
  if (row.openedAt) return true;
  const state = await openStateOf(tx, trackId);
  if (!state.contributors.every((p) => p.consented)) return false;
  await tx.update(openTracks).set({ openedAt: new Date() }).where(eq(openTracks.trackId, trackId));
  return true;
}

// Asks to open the newest approved version with all stems. A pending request starts over,
// so a changed license needs everyone's consent again. Returns null without an approved version.
export async function requestOpen(db: Database, trackId: string, userId: string, license: OpenLicense) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'open:' + trackId}))`);
    const version = await approvedVersion(tx, trackId);
    if (!version) return null;

    await tx.delete(openTracks).where(and(eq(openTracks.trackId, trackId), isNull(openTracks.openedAt)));
    const [row] = await tx
      .insert(openTracks)
      .values({ trackId, versionId: version.id, license, requestedById: userId })
      .onConflictDoNothing()
      .returning();
    // Already open: closing comes first
    if (!row) return { opened: true };
    await tx.insert(openConsents).values({ trackId, userId });
    return { opened: await openIfAgreed(tx, trackId) };
  });
}

// Returns null if the user isn't asked for consent
export async function consentToOpen(db: Database, trackId: string, userId: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'open:' + trackId}))`);
    const state = await openStateOf(tx, trackId);
    if (!state.license || !state.contributors.some((p) => p.id === userId)) return null;
    await tx.insert(openConsents).values({ trackId, userId }).onConflictDoNothing();
    return { opened: await openIfAgreed(tx, trackId) };
  });
}

// An open track whose project, track, version and owner are all still there
export async function liveOpenTrack(db: Db, trackId: string) {
  const [row] = await db
    .select({ open: openTracks, track: tracks, version: versions, project: projects })
    .from(openTracks)
    .innerJoin(tracks, eq(tracks.id, openTracks.trackId))
    .innerJoin(versions, eq(versions.id, openTracks.versionId))
    .innerJoin(projects, eq(projects.id, tracks.projectId))
    .where(
      and(
        eq(openTracks.trackId, trackId),
        isNotNull(openTracks.openedAt),
        isNull(tracks.deletedAt),
        isNull(versions.deletedAt),
        notBlocked(projects.createdById),
      ),
    );
  return row;
}

// Stems that were there when the track opened; later uploads stay private
export async function openStems(db: Db, trackId: string, openedAt: Date) {
  return db
    .select()
    .from(stems)
    .where(and(eq(stems.trackId, trackId), isNull(stems.deletedAt), lte(stems.createdAt, openedAt)))
    .orderBy(asc(stems.sortOrder), asc(stems.createdAt));
}

export const artistOf = (project: { name: string; artist: string | null }) => project.artist || project.name;

// "„Nachtbus“ von Fernlicht (Robin, Lea) · CC BY-SA 4.0 · https://…/offen/<id>"
export function creditLine(trackName: string, artist: string, names: string[], license: OpenLicense, trackId: string) {
  const people = names.length && !(names.length === 1 && names[0] === artist) ? ` (${names.join(', ')})` : '';
  return `„${trackName}“ von ${artist}${people} · ${OPEN_LICENSE_INFO[license].label} · ${openUrl(trackId)}`;
}

// Takes an open track over into one of the user's projects as a new track. The stems point to the
// same files as the original, so a remix costs no storage until the user uploads something.
// Returns null if the track isn't open or the user may not add tracks to the project.
export async function forkTrack(db: Database, sourceId: string, userId: string, projectId: string) {
  const source = await liveOpenTrack(db, sourceId);
  if (!source) return null;
  const [membership] = await db
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
  if (!membership?.canUpload) return null;

  const license = source.open.license as OpenLicense;
  const names = (await contributorsOf(db, sourceId, source.version.id, source.open.requestedById)).map((p) => p.name);
  const files = await openStems(db, sourceId, source.open.openedAt!);

  return db.transaction(async (tx) => {
    const [track] = await tx
      .insert(tracks)
      .values({
        projectId,
        name: `${source.track.name} (Remix)`.slice(0, 255),
        createdById: userId,
        forkedFromId: sourceId,
        license,
        credit: creditLine(source.track.name, artistOf(source.project), names, license, sourceId),
      })
      .returning();
    if (files.length) {
      await tx.insert(stems).values(
        files.map((s) => ({
          trackId: track.id,
          name: s.name,
          originalFileName: s.originalFileName,
          mimeType: s.mimeType,
          fileSize: s.fileSize,
          fileKey: s.fileKey,
          sortOrder: s.sortOrder,
          forked: true,
          createdById: userId,
        })),
      );
    }
    return track;
  });
}

// Remixes of a track and their remixes. Only open ones show with their name, the others are counted.
export async function remixesOf(db: Db, trackId: string) {
  const level = async (parentIds: string[]) =>
    parentIds.length
      ? db
          .select({
            id: tracks.id,
            parentId: tracks.forkedFromId,
            name: tracks.name,
            artist: sql<string>`coalesce(${projects.artist}, ${projects.name})`,
            open: sql<boolean>`${openTracks.openedAt} is not null`,
          })
          .from(tracks)
          .innerJoin(projects, eq(projects.id, tracks.projectId))
          .leftJoin(openTracks, eq(openTracks.trackId, tracks.id))
          .where(and(inArray(tracks.forkedFromId, parentIds), isNull(tracks.deletedAt)))
          .orderBy(asc(tracks.createdAt))
      : [];
  const first = await level([trackId]);
  const second = await level(first.map((t) => t.id));
  const show = (t: (typeof first)[number]) => ({ id: t.id, name: t.name, artist: t.artist });
  return {
    count: first.length + second.length,
    open: first
      .filter((t) => t.open)
      .map((t) => ({ ...show(t), remixes: second.filter((s) => s.parentId === t.id && s.open).map(show) })),
  };
}
