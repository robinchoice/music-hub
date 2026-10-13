import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { hasPermission, type RequestsFrom } from '@music-hub/shared';
import {
  contactRequests,
  profiles,
  projectMembers,
  projects,
  userBlocks,
  users,
  type Database,
} from '@music-hub/db';

const DAY = 24 * 60 * 60 * 1000;
// After a silent decline the same person can't ask again for this long
export const DECLINED_PAUSE = 30 * DAY;

// Open tracks someone worked on: asked to open it, uploaded the open mix or one of its own stems.
// Same visibility as liveOpenTrack(): opened, not in the trash, project owner not blocked.
const openTracksOfSql = (userId: string) => sql`
  SELECT t.id, t.name, t.forked_from_id AS "forkedFromId", ot.license, ot.download_count AS "downloads",
    coalesce(t.cover_image_url, p.cover_image_url) AS "cover", p.artist,
    coalesce(p.artist, p.name) AS "artistOrProject",
    (SELECT count(*)::int FROM stems s WHERE s.track_id = t.id AND s.deleted_at IS NULL AND s.created_at <= ot.opened_at) AS "stemCount",
    (SELECT count(*)::int FROM tracks r WHERE r.forked_from_id = t.id AND r.deleted_at IS NULL) AS "remixCount",
    (SELECT count(*)::int FROM tracks r WHERE r.forked_from_id = t.id AND r.deleted_at IS NULL AND r.created_by_id <> ${userId}) AS "remixesByOthers",
    (SELECT count(*)::int FROM stars st WHERE st.track_id = t.id) AS "stars"
  FROM open_tracks ot
  JOIN tracks t ON t.id = ot.track_id
  JOIN versions v ON v.id = ot.version_id
  JOIN projects p ON p.id = t.project_id
  WHERE ot.opened_at IS NOT NULL AND t.deleted_at IS NULL AND v.deleted_at IS NULL
    AND p.created_by_id NOT IN (SELECT id FROM users WHERE blocked_at IS NOT NULL)
    AND (ot.requested_by_id = ${userId} OR v.created_by_id = ${userId}
      OR EXISTS (SELECT 1 FROM stems s WHERE s.track_id = t.id AND s.created_by_id = ${userId}
        AND NOT s.forked AND s.deleted_at IS NULL AND s.created_at <= ot.opened_at))
  ORDER BY ot.opened_at DESC
`;

export type ProfileTrack = {
  id: string;
  name: string;
  forkedFromId: string | null;
  license: string;
  downloads: number;
  cover: string | null;
  artist: string | null;
  artistOrProject: string;
  stemCount: number;
  remixCount: number;
  remixesByOthers: number;
  stars: number;
};

export async function openTracksOf(db: Database, userId: string) {
  return db.execute<ProfileTrack>(openTracksOfSql(userId));
}

// A visible profile of an account that isn't blocked
export async function visibleProfile(db: Database, handle: string) {
  const [row] = await db
    .select({ profile: profiles, name: users.name, avatarUrl: users.avatarUrl })
    .from(profiles)
    .innerJoin(users, and(eq(users.id, profiles.userId), isNull(users.blockedAt)))
    .where(and(eq(profiles.handle, handle.toLowerCase()), eq(profiles.visible, true)));
  return row;
}

// Handles of the given users that show a profile, for links from open track pages
export async function handlesOf(db: Database, userIds: string[]) {
  if (!userIds.length) return new Map<string, string>();
  const rows = await db
    .select({ userId: profiles.userId, handle: profiles.handle })
    .from(profiles)
    .where(and(inArray(profiles.userId, userIds), eq(profiles.visible, true)));
  return new Map(rows.map((r) => [r.userId, r.handle]));
}

// A first handle from the display name: "Lea Brandt" → "lea-brandt"
export function suggestHandle(name: string) {
  const base = name
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
  return base.length >= 2 ? base : 'musik';
}

// What the button on a profile does for the person looking at it:
// 'login', 'self', 'allowed', 'sent' (one is waiting or was declined lately), 'needs-open' or 'closed'
export type ContactState = 'login' | 'self' | 'allowed' | 'sent' | 'needs-open' | 'closed';

export async function contactState(
  db: Database,
  profile: { userId: string; requestsFrom: string },
  viewerId: string | undefined,
): Promise<ContactState> {
  if (!viewerId) return 'login';
  if (viewerId === profile.userId) return 'self';
  if ((profile.requestsFrom as RequestsFrom) === 'nobody') return 'closed';
  const [blocked] = await db
    .select()
    .from(userBlocks)
    .where(and(eq(userBlocks.userId, profile.userId), eq(userBlocks.blockedUserId, viewerId)));
  if (blocked) return 'closed';

  const [earlier] = await db
    .select({ id: contactRequests.id })
    .from(contactRequests)
    .where(
      and(
        eq(contactRequests.fromUserId, viewerId),
        eq(contactRequests.toUserId, profile.userId),
        or(
          eq(contactRequests.status, 'pending'),
          and(eq(contactRequests.status, 'declined'), gt(contactRequests.answeredAt, new Date(Date.now() - DECLINED_PAUSE))),
        ),
      ),
    )
    .limit(1);
  if (earlier) return 'sent';

  if (profile.requestsFrom === 'open' && !(await openTracksOf(db, viewerId)).length) return 'needs-open';
  return 'allowed';
}

// Requests waiting for this user, newest first
export async function pendingRequests(db: Database, userId: string) {
  return db
    .select({
      id: contactRequests.id,
      message: contactRequests.message,
      trackId: contactRequests.trackId,
      createdAt: contactRequests.createdAt,
      from: { id: users.id, name: users.name, avatarUrl: users.avatarUrl, handle: profiles.handle, bio: profiles.bio },
    })
    .from(contactRequests)
    .innerJoin(users, and(eq(users.id, contactRequests.fromUserId), isNull(users.blockedAt)))
    .leftJoin(profiles, and(eq(profiles.userId, users.id), eq(profiles.visible, true)))
    .where(and(eq(contactRequests.toUserId, userId), eq(contactRequests.status, 'pending')))
    .orderBy(desc(contactRequests.createdAt));
}

// Accepting puts the sender into a project of the recipient: a new one for both, or one where the
// recipient may invite. Returns the project id, or null if the request or the project doesn't fit.
export async function acceptRequest(db: Database, requestId: string, userId: string, projectId?: string) {
  return db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(contactRequests)
      .where(and(eq(contactRequests.id, requestId), eq(contactRequests.toUserId, userId), eq(contactRequests.status, 'pending')))
      .for('update');
    if (!request) return null;

    if (projectId) {
      const [membership] = await tx
        .select({ role: projectMembers.role })
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
      if (membership?.role !== 'owner' && membership?.role !== 'management') return null;
    } else {
      const [[me], [sender]] = await Promise.all([
        tx.select({ name: users.name }).from(users).where(eq(users.id, userId)),
        tx.select({ name: users.name }).from(users).where(eq(users.id, request.fromUserId)),
      ]);
      const [project] = await tx
        .insert(projects)
        .values({
          name: `${me.name} × ${sender.name}`.slice(0, 255),
          description: `Anfrage von ${sender.name}: ${request.message}`,
          createdById: userId,
        })
        .returning();
      await tx.insert(projectMembers).values({
        projectId: project.id,
        userId,
        role: 'owner',
        canUpload: true,
        canComment: true,
        canApprove: true,
      });
      projectId = project.id;
    }

    await tx
      .insert(projectMembers)
      .values({
        projectId,
        userId: request.fromUserId,
        role: 'artist',
        canUpload: hasPermission('artist', 'track.upload'),
        canComment: hasPermission('artist', 'version.comment'),
        canApprove: hasPermission('artist', 'version.approve'),
      })
      .onConflictDoNothing();
    await tx
      .update(contactRequests)
      .set({ status: 'accepted', projectId, answeredAt: new Date() })
      .where(eq(contactRequests.id, requestId));
    return { projectId, fromUserId: request.fromUserId };
  });
}

// Declines silently; with block the sender can't ask again
export async function declineRequest(db: Database, requestId: string, userId: string, block = false, report = false) {
  return db.transaction(async (tx) => {
    const [request] = await tx
      .update(contactRequests)
      .set({ status: 'declined', answeredAt: new Date(), ...(report ? { reportedAt: new Date() } : {}) })
      .where(and(eq(contactRequests.id, requestId), eq(contactRequests.toUserId, userId), eq(contactRequests.status, 'pending')))
      .returning();
    if (!request) return null;
    if (block) await tx.insert(userBlocks).values({ userId, blockedUserId: request.fromUserId }).onConflictDoNothing();
    return request;
  });
}
