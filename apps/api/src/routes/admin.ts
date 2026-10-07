import { Hono } from 'hono';
import { and, eq, gt, gte, isNotNull, lt, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { MAX_STORAGE_PER_USER } from '@music-hub/shared';
import {
  users,
  sessions,
  magicLinks,
  projects,
  projectMembers,
  tracks,
  versions,
  stems,
  comments,
  shareLinks,
  listenEvents,
  pushSubscriptions,
  type Database,
} from '@music-hub/db';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin, isAdminEmail, deviceLabel } from '../lib/admin.js';
import { keptSql } from '../lib/trash.js';
import type { AppEnv } from '../types.js';

const DAY = 86_400_000;
// Seen this recently counts as online; markSeen() writes last_seen_at every two minutes
const ONLINE_MS = 5 * 60_000;
// Plugin sessions run 180 days, browser sessions 30
const PLUGIN_SESSION_MS = 90 * DAY;
// Days and weeks of the charts follow the clock of the people using Music Hub
const TZ = 'Europe/Berlin';
// Same prefix the reject route writes; such a comment is the reason of a rejection, not a comment of its own
const REJECTION_LIKE = '❌ Abgelehnt: %';

// Timestamp columns hold UTC. Raw rows get them as ISO strings, so nothing depends on the process time zone.
const iso = (expr: SQL) => sql`to_char(${expr}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const ts = (date: Date) => sql`${date.toISOString()}::timestamptz`;

// Everything people did since `from`, one row per action: who, what, when
function actionsSql(from: Date) {
  const f = ts(from);
  return sql`
    SELECT user_id AS uid, 'login' AS type, created_at AS at FROM sessions WHERE created_at >= ${f}
    UNION ALL SELECT u.id, 'login', m.used_at FROM magic_links m JOIN users u ON lower(u.email) = lower(m.email) WHERE m.used_at >= ${f}
    UNION ALL SELECT created_by_id, 'version', created_at FROM versions WHERE created_at >= ${f}
    UNION ALL SELECT created_by_id, 'stem', created_at FROM stems WHERE created_at >= ${f}
    UNION ALL SELECT user_id, 'comment', created_at FROM comments
      WHERE user_id IS NOT NULL AND body NOT LIKE ${REJECTION_LIKE} AND created_at >= ${f}
    UNION ALL SELECT decided_by_id, CASE WHEN status = 'rejected' THEN 'reject' ELSE 'approve' END, decided_at FROM versions
      WHERE decided_by_id IS NOT NULL AND decided_at >= ${f}
    UNION ALL SELECT created_by_id, 'share', created_at FROM share_links WHERE created_at >= ${f}
    UNION ALL SELECT user_id, 'push', created_at FROM push_subscriptions WHERE created_at >= ${f}
    UNION ALL SELECT user_id, 'task', created_at FROM task_dismissals WHERE created_at >= ${f}
    UNION ALL SELECT id, 'tracks', tracks_seen_at FROM users WHERE tracks_seen_at >= ${f}
  `;
}

type Counts = { versions: number; stems: number; comments: number; approvals: number; plays: number };
const NO_COUNTS: Counts = { versions: 0, stems: 0, comments: 0, approvals: 0, plays: 0 };

async function lastActions(db: Database) {
  const rows = await db.execute<{ uid: string; type: string; at: string }>(sql`
    SELECT DISTINCT ON (uid) uid, type, ${iso(sql.raw('a.at'))} AS at
    FROM (${actionsSql(new Date(0))}) a
    WHERE uid IS NOT NULL
    ORDER BY uid, a.at DESC
  `);
  return new Map(rows.map((r) => [r.uid, { type: r.type, at: r.at }]));
}

async function actionCounts(db: Database, from: Date) {
  const rows = await db.execute<Omit<Counts, 'plays'> & { uid: string }>(sql`
    SELECT uid,
      count(*) FILTER (WHERE type = 'version')::int AS versions,
      count(*) FILTER (WHERE type = 'stem')::int AS stems,
      count(*) FILTER (WHERE type = 'comment')::int AS comments,
      count(*) FILTER (WHERE type = 'approve')::int AS approvals
    FROM (${actionsSql(from)}) a
    WHERE uid IS NOT NULL
    GROUP BY uid
  `);
  // Guests playing the links a person created
  const plays = await db.execute<{ uid: string; plays: number }>(sql`
    SELECT l.created_by_id AS uid, count(*)::int AS plays
    FROM listen_events e JOIN share_links l ON l.id = e.share_link_id
    WHERE e.first_play_at IS NOT NULL AND e.opened_at >= ${ts(from)}
    GROUP BY l.created_by_id
  `);
  const counts = new Map<string, Counts>();
  for (const r of rows) {
    counts.set(r.uid, { versions: r.versions, stems: r.stems, comments: r.comments, approvals: r.approvals, plays: 0 });
  }
  for (const p of plays) counts.set(p.uid, { ...(counts.get(p.uid) ?? NO_COUNTS), plays: p.plays });
  return counts;
}

// Counted like storageOf() in lib/storage.ts
async function storageByUser(db: Database) {
  const rows = await db.execute<{ uid: string; bytes: number }>(sql`
    SELECT uid, sum(size)::float8 AS bytes FROM (
      SELECT v.created_by_id AS uid, v.file_size AS size FROM versions v JOIN tracks t ON t.id = v.track_id
        WHERE ${keptSql('v')} AND ${keptSql('t')}
      UNION ALL
      SELECT s.created_by_id, s.file_size FROM stems s JOIN tracks t ON t.id = s.track_id
        WHERE ${keptSql('s')} AND ${keptSql('t')}
    ) x
    GROUP BY uid
  `);
  return new Map(rows.map((r) => [r.uid, Number(r.bytes)]));
}

// Everyone with what they did since `from`. Accounts only come from invites, so never having
// logged in shows as: no action, never seen and no password.
async function loadPeople(db: Database, from: Date) {
  const [userRows, last, counts, storage, memberships, openLinks] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
        createdAt: users.createdAt,
        lastSeenAt: users.lastSeenAt,
        hasPassword: sql<boolean>`${users.passwordHash} IS NOT NULL`,
        blockedAt: users.blockedAt,
        storageLimit: users.storageLimit,
      })
      .from(users),
    lastActions(db),
    actionCounts(db, from),
    storageByUser(db),
    db
      .select({
        userId: projectMembers.userId,
        projectId: projectMembers.projectId,
        role: projectMembers.role,
        invitedAt: projectMembers.invitedAt,
        projectName: projects.name,
        artist: projects.artist,
        createdById: projects.createdById,
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .orderBy(projectMembers.invitedAt),
    // The newest unused login link per address; for someone who never logged in, the one from the invite
    db.execute<{ email: string; expiresAt: string }>(sql`
      SELECT DISTINCT ON (lower(email)) lower(email) AS email, ${iso(sql.raw('expires_at'))} AS "expiresAt"
      FROM magic_links
      WHERE used_at IS NULL
      ORDER BY lower(email), created_at DESC
    `),
  ]);
  const linkExpiry = new Map(openLinks.map((l) => [l.email, l.expiresAt]));
  const now = Date.now();

  const people = userRows.map((u) => {
    const lastAction = last.get(u.id) ?? null;
    const lastSeenAt = u.lastSeenAt?.toISOString() ?? null;
    const lastActiveAt = [lastSeenAt, lastAction?.at ?? null].reduce<string | null>((a, b) => (b && (!a || b > a) ? b : a), null);
    const own = memberships.filter((m) => m.userId === u.id);
    // The first project someone else invited them to; the very first account has none
    const invite = own.find((m) => m.createdById !== u.id);
    const pending = !lastActiveAt && !u.hasPassword;
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      avatarUrl: u.avatarUrl,
      isAdmin: isAdminEmail(u.email),
      createdAt: u.createdAt.toISOString(),
      invitedTo: invite
        ? { projectId: invite.projectId, projectName: invite.projectName, role: invite.role, at: invite.invitedAt.toISOString() }
        : null,
      pending,
      inviteExpiresAt: pending ? (linkExpiry.get(u.email.toLowerCase()) ?? null) : null,
      hasPassword: u.hasPassword,
      blocked: !!u.blockedAt,
      lastSeenAt,
      online: !!u.lastSeenAt && now - u.lastSeenAt.getTime() < ONLINE_MS,
      lastAction,
      lastActiveAt,
      projectCount: own.length,
      storageBytes: storage.get(u.id) ?? 0,
      storageLimitBytes: u.storageLimit ?? MAX_STORAGE_PER_USER,
      counts: counts.get(u.id) ?? NO_COUNTS,
    };
  });
  return { people, memberships };
}

// Per day or calendar week in Berlin time, oldest first: how many people did something,
// or with `userId` how many actions that person took
async function activitySeries(db: Database, unit: 'day' | 'week', count: number, userId?: string) {
  const from = new Date(Date.now() - (count * (unit === 'week' ? 7 : 1) + 7) * DAY);
  const step = `1 ${unit}`;
  const rows = await db.execute<{ start: string; value: number }>(sql`
    WITH a AS (
      SELECT uid, date_trunc(${unit}, at AT TIME ZONE 'UTC' AT TIME ZONE ${TZ}) AS bucket
      FROM (${actionsSql(from)}) x
      WHERE uid IS NOT NULL ${userId ? sql`AND uid = ${userId}` : sql``}
    ), b AS (
      SELECT generate_series(
        date_trunc(${unit}, now() AT TIME ZONE ${TZ}) - ${count - 1}::int * ${step}::interval,
        date_trunc(${unit}, now() AT TIME ZONE ${TZ}),
        ${step}::interval
      ) AS bucket
    )
    SELECT to_char(b.bucket, 'YYYY-MM-DD') AS start,
      ${userId ? sql`count(a.uid)` : sql`count(DISTINCT a.uid)`}::int AS value
    FROM b LEFT JOIN a ON a.bucket = b.bucket
    GROUP BY b.bucket
    ORDER BY b.bucket
  `);
  return rows.map((r) => ({ start: r.start, value: r.value }));
}

async function periodTotals(db: Database, from: Date, to: Date) {
  const range = (column: string) => sql`${sql.raw(column)} >= ${ts(from)} AND ${sql.raw(column)} < ${ts(to)}`;
  const [row] = await db.execute<{
    versions: number;
    stems: number;
    comments: number;
    guestComments: number;
    opens: number;
    plays: number;
    complete: number;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM versions WHERE ${range('created_at')}) AS versions,
      (SELECT count(*)::int FROM stems WHERE ${range('created_at')}) AS stems,
      (SELECT count(*)::int FROM comments
        WHERE user_id IS NOT NULL AND body NOT LIKE ${REJECTION_LIKE} AND ${range('created_at')}) AS comments,
      (SELECT count(*)::int FROM comments WHERE user_id IS NULL AND ${range('created_at')}) AS "guestComments",
      (SELECT count(*)::int FROM listen_events WHERE ${range('opened_at')}) AS opens,
      (SELECT count(*)::int FROM listen_events WHERE first_play_at IS NOT NULL AND ${range('opened_at')}) AS plays,
      (SELECT count(*)::int FROM listen_events WHERE completed AND ${range('opened_at')}) AS complete
  `);
  return row!;
}

async function projectActivity(db: Database, from: Date) {
  const f = ts(from);
  const inProject = sql.raw('JOIN tracks t ON t.id = v.track_id WHERE t.project_id = p.id');
  return db.execute<{
    id: string;
    name: string;
    artist: string | null;
    archived: boolean;
    uploads: number;
    comments: number;
    lastActivityAt: string | null;
  }>(sql`
    SELECT p.id, p.name, p.artist, p.is_archived AS archived,
      (SELECT count(*)::int FROM versions v ${inProject} AND v.created_at >= ${f})
        + (SELECT count(*)::int FROM stems s JOIN tracks t ON t.id = s.track_id WHERE t.project_id = p.id AND s.created_at >= ${f})
        AS uploads,
      (SELECT count(*)::int FROM comments c JOIN versions v ON v.id = c.version_id ${inProject}
        AND c.body NOT LIKE ${REJECTION_LIKE} AND c.created_at >= ${f}) AS comments,
      ${iso(sql`greatest(
        (SELECT max(v.created_at) FROM versions v ${inProject}),
        (SELECT max(v.decided_at) FROM versions v ${inProject}),
        (SELECT max(s.created_at) FROM stems s JOIN tracks t ON t.id = s.track_id WHERE t.project_id = p.id),
        (SELECT max(c.created_at) FROM comments c JOIN versions v ON v.id = c.version_id ${inProject}),
        (SELECT max(l.created_at) FROM share_links l JOIN versions v ON v.id = l.version_id ${inProject})
      )`)} AS "lastActivityAt"
    FROM projects p
  `);
}

async function topShareLinks(db: Database, from: Date) {
  return db.execute<{
    id: string;
    trackName: string;
    versionNumber: number;
    projectName: string;
    creatorName: string;
    opens: number;
    plays: number;
  }>(sql`
    SELECT l.id, t.name AS "trackName", v.version_number AS "versionNumber", p.name AS "projectName",
      u.name AS "creatorName", count(*)::int AS opens, count(e.first_play_at)::int AS plays
    FROM listen_events e
    JOIN share_links l ON l.id = e.share_link_id
    JOIN versions v ON v.id = l.version_id
    JOIN tracks t ON t.id = v.track_id
    JOIN projects p ON p.id = t.project_id
    JOIN users u ON u.id = l.created_by_id
    WHERE e.opened_at >= ${ts(from)}
    GROUP BY l.id, t.name, v.version_number, p.name, u.name
    ORDER BY plays DESC, opens DESC
    LIMIT 4
  `);
}

type AdminEvent = {
  type: 'login' | 'version' | 'stems' | 'comment' | 'decision' | 'share' | 'listen' | 'invite' | 'push';
  at: string;
  // Who did it; for invites the invited person, for guests null
  userId: string | null;
  projectId?: string;
  projectName?: string;
  trackName?: string;
  versionNumber?: number;
  // login: password, magic_link, invite, registration or plugin
  via?: string;
  count?: number;
  status?: string;
  until?: string | null;
  password?: boolean;
  guestName?: string | null;
  linkCreatorId?: string | null;
  played?: boolean;
  seconds?: number;
  duration?: number | null;
  completed?: boolean;
  device?: string;
  role?: string;
};

// What happened between `from` and `to`, newest first; metadata only, no comment texts
async function loadEvents(db: Database, { from, to, userId }: { from: Date; to: Date; userId?: string }) {
  const within = (column: PgColumn) => and(gte(column, from), lt(column, to));
  const by = (column: PgColumn) => (userId ? eq(column, userId) : undefined);
  const place = { projectId: projects.id, projectName: projects.name, trackName: tracks.name };
  const onTrack = eq(tracks.id, versions.trackId);
  const onProject = eq(projects.id, tracks.projectId);

  const [
    sessionRows,
    linkRows,
    userRows,
    versionRows,
    stemRows,
    commentRows,
    decisionRows,
    shareRows,
    listenRows,
    inviteRows,
    pushRows,
    allLinks,
  ] = await Promise.all([
    db
      .select({ userId: sessions.userId, createdAt: sessions.createdAt, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(and(within(sessions.createdAt), by(sessions.userId))),
    db
      .select({
        email: magicLinks.email,
        createdAt: magicLinks.createdAt,
        expiresAt: magicLinks.expiresAt,
        usedAt: magicLinks.usedAt,
        registration: sql<boolean>`${magicLinks.passwordHash} IS NOT NULL`,
      })
      .from(magicLinks)
      .where(within(magicLinks.usedAt)),
    db.select({ id: users.id, email: users.email }).from(users),
    db
      .select({ at: versions.createdAt, userId: versions.createdById, versionNumber: versions.versionNumber, ...place })
      .from(versions)
      .innerJoin(tracks, onTrack)
      .innerJoin(projects, onProject)
      .where(and(within(versions.createdAt), by(versions.createdById))),
    db
      .select({ at: stems.createdAt, userId: stems.createdById, trackId: stems.trackId, ...place })
      .from(stems)
      .innerJoin(tracks, eq(tracks.id, stems.trackId))
      .innerJoin(projects, onProject)
      .where(and(within(stems.createdAt), by(stems.createdById)))
      .orderBy(stems.createdAt),
    db
      .select({
        at: comments.createdAt,
        userId: comments.userId,
        guestName: comments.guestName,
        versionId: comments.versionId,
        versionNumber: versions.versionNumber,
        ...place,
      })
      .from(comments)
      .innerJoin(versions, eq(versions.id, comments.versionId))
      .innerJoin(tracks, onTrack)
      .innerJoin(projects, onProject)
      .where(and(within(comments.createdAt), sql`${comments.body} NOT LIKE ${REJECTION_LIKE}`, by(comments.userId))),
    db
      .select({
        at: versions.decidedAt,
        userId: versions.decidedById,
        status: versions.status,
        versionNumber: versions.versionNumber,
        ...place,
      })
      .from(versions)
      .innerJoin(tracks, onTrack)
      .innerJoin(projects, onProject)
      .where(and(isNotNull(versions.decidedById), within(versions.decidedAt), by(versions.decidedById))),
    db
      .select({
        at: shareLinks.createdAt,
        userId: shareLinks.createdById,
        until: shareLinks.expiresAt,
        password: sql<boolean>`${shareLinks.passwordHash} IS NOT NULL`,
        versionNumber: versions.versionNumber,
        ...place,
      })
      .from(shareLinks)
      .innerJoin(versions, eq(versions.id, shareLinks.versionId))
      .innerJoin(tracks, onTrack)
      .innerJoin(projects, onProject)
      .where(and(within(shareLinks.createdAt), by(shareLinks.createdById))),
    // Guests are nobody's actions
    userId
      ? Promise.resolve([])
      : db
          .select({
            at: listenEvents.openedAt,
            guestName: listenEvents.listenerName,
            played: sql<boolean>`${listenEvents.firstPlayAt} IS NOT NULL`,
            seconds: listenEvents.listenSeconds,
            completed: listenEvents.completed,
            userAgent: listenEvents.userAgent,
            linkCreatorId: shareLinks.createdById,
            duration: versions.duration,
            versionNumber: versions.versionNumber,
            ...place,
          })
          .from(listenEvents)
          .innerJoin(shareLinks, eq(shareLinks.id, listenEvents.shareLinkId))
          .innerJoin(versions, eq(versions.id, shareLinks.versionId))
          .innerJoin(tracks, onTrack)
          .innerJoin(projects, onProject)
          .where(within(listenEvents.openedAt)),
    // Who invited is not stored. The creator's own membership is no invite.
    db
      .select({
        at: projectMembers.invitedAt,
        userId: projectMembers.userId,
        role: projectMembers.role,
        projectId: projects.id,
        projectName: projects.name,
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(and(within(projectMembers.invitedAt), sql`${projectMembers.userId} <> ${projects.createdById}`, by(projectMembers.userId))),
    db
      .select({ at: pushSubscriptions.createdAt, userId: pushSubscriptions.userId, userAgent: pushSubscriptions.userAgent })
      .from(pushSubscriptions)
      .where(and(within(pushSubscriptions.createdAt), by(pushSubscriptions.userId))),
    db.select({ versionId: shareLinks.versionId, createdById: shareLinks.createdById, createdAt: shareLinks.createdAt }).from(shareLinks),
  ]);

  const events: AdminEvent[] = [];
  const toIso = (d: Date) => d.toISOString();

  // A magic link login also creates a session; the link tells how someone came in
  const idByEmail = new Map(userRows.map((u) => [u.email.toLowerCase(), u.id]));
  const matched = new Set<number>();
  for (const l of linkRows) {
    const uid = idByEmail.get(l.email.toLowerCase());
    if (!uid || (userId && uid !== userId) || !l.usedAt) continue;
    const usedAt = l.usedAt.getTime();
    const i = sessionRows.findIndex(
      (s, i) => !matched.has(i) && s.userId === uid && Math.abs(s.createdAt.getTime() - usedAt) < 60_000,
    );
    if (i >= 0) matched.add(i);
    // Invite links run 7 days, links from the login page 15 minutes
    const via = l.registration ? 'registration' : l.expiresAt.getTime() - l.createdAt.getTime() > DAY ? 'invite' : 'magic_link';
    events.push({ type: 'login', at: toIso(l.usedAt), userId: uid, via });
  }
  sessionRows.forEach((s, i) => {
    if (matched.has(i)) return;
    const via = s.expiresAt.getTime() - s.createdAt.getTime() > PLUGIN_SESSION_MS ? 'plugin' : 'password';
    events.push({ type: 'login', at: toIso(s.createdAt), userId: s.userId, via });
  });

  for (const v of versionRows) events.push({ type: 'version', ...v, at: toIso(v.at) });

  // Stems come in batches: one entry per person and track as long as they follow within half an hour
  const batches = new Map<string, { event: AdminEvent; last: number }>();
  for (const { trackId, ...s } of stemRows) {
    const key = `${s.userId}:${trackId}`;
    const batch = batches.get(key);
    const t = s.at.getTime();
    if (batch && t - batch.last < 30 * 60_000) {
      batch.event.count! += 1;
      batch.event.at = toIso(s.at);
      batch.last = t;
    } else {
      const event: AdminEvent = { type: 'stems', ...s, at: toIso(s.at), count: 1 };
      events.push(event);
      batches.set(key, { event, last: t });
    }
  }

  // Guests comment through a link; the newest link of the version at that time
  const linkCreator = (versionId: string, at: Date) =>
    allLinks
      .filter((l) => l.versionId === versionId && l.createdAt <= at)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]?.createdById ?? null;
  for (const { versionId, ...c } of commentRows) {
    events.push({
      type: 'comment',
      ...c,
      at: toIso(c.at),
      linkCreatorId: c.userId ? null : linkCreator(versionId, c.at),
    });
  }

  for (const d of decisionRows) events.push({ type: 'decision', ...d, at: toIso(d.at!) });
  for (const s of shareRows) events.push({ type: 'share', ...s, at: toIso(s.at), until: s.until ? toIso(s.until) : null });
  for (const { userAgent, ...l } of listenRows) {
    events.push({ type: 'listen', ...l, userId: null, at: toIso(l.at), device: deviceLabel(userAgent) });
  }
  for (const m of inviteRows) events.push({ type: 'invite', ...m, at: toIso(m.at) });
  for (const p of pushRows) events.push({ type: 'push', userId: p.userId, at: toIso(p.at), device: deviceLabel(p.userAgent) });

  return events.sort((a, b) => b.at.localeCompare(a.at));
}

const parseDate = (value: string | undefined) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

export const adminRoutes = new Hono<AppEnv>()
  .use('*', requireAuth, requireAdmin)

  // Lagebild: totals of the period and the one before, active people per day or week, lists
  .get('/overview', async (c) => {
    const db = c.get('db');
    const days = [7, 30, 90].includes(Number(c.req.query('days'))) ? Number(c.req.query('days')) : 30;
    const now = new Date();
    const from = new Date(now.getTime() - days * DAY);
    const [{ people, memberships }, current, previous, series, projectRows, shareRows] = await Promise.all([
      loadPeople(db, from),
      periodTotals(db, from, now),
      periodTotals(db, new Date(from.getTime() - days * DAY), from),
      days === 90 ? activitySeries(db, 'week', 13) : activitySeries(db, 'day', days),
      projectActivity(db, from),
      topShareLinks(db, from),
    ]);
    const pending = new Set(people.filter((p) => p.pending).map((p) => p.id));

    return c.json({
      days,
      people,
      current,
      previous,
      series: { unit: days === 90 ? 'week' : 'day', points: series },
      projects: projectRows
        .map((p) => {
          const members = memberships.filter((m) => m.projectId === p.id);
          return { ...p, members: members.length, openInvites: members.filter((m) => pending.has(m.userId)).length };
        })
        .sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? '')),
      shareLinks: [...shareRows],
      storageLimitBytes: MAX_STORAGE_PER_USER,
    });
  })

  // Nutzerliste: everyone with their numbers of the last 30 days or of all time
  .get('/users', async (c) => {
    const from = c.req.query('range') === 'all' ? new Date(0) : new Date(Date.now() - 30 * DAY);
    const { people } = await loadPeople(c.get('db'), from);
    return c.json({ people, storageLimitBytes: MAX_STORAGE_PER_USER });
  })

  .get('/users/:id', async (c) => {
    const db = c.get('db');
    const id = c.req.param('id');
    const { people, memberships } = await loadPeople(db, new Date(Date.now() - 30 * DAY));
    const person = people.find((p) => p.id === id);
    if (!person) return c.json({ error: 'Not found' }, 404);

    const [allTime, weekly, events, pushRows, pluginRows] = await Promise.all([
      actionCounts(db, new Date(0)),
      activitySeries(db, 'week', 12, id),
      loadEvents(db, { from: new Date(0), to: new Date(), userId: id }),
      db
        .select({ userAgent: pushSubscriptions.userAgent, createdAt: pushSubscriptions.createdAt })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, id)),
      db
        .select({ createdAt: sessions.createdAt })
        .from(sessions)
        .where(
          and(
            eq(sessions.userId, id),
            gt(sessions.expiresAt, new Date()),
            sql`${sessions.expiresAt} - ${sessions.createdAt} > make_interval(days => ${PLUGIN_SESSION_MS / DAY})`,
          ),
        ),
    ]);

    return c.json({
      person: { ...person, countsAll: allTime.get(id) ?? NO_COUNTS },
      weekly,
      activity: events.filter((e) => e.type !== 'login').slice(0, 6),
      logins: events.filter((e) => e.type === 'login').slice(0, 4),
      projects: memberships
        .filter((m) => m.userId === id)
        .map((m) => ({ id: m.projectId, name: m.projectName, artist: m.artist, role: m.role, since: m.invitedAt.toISOString() })),
      devices: [
        ...pushRows.map((p) => ({ kind: 'push' as const, label: deviceLabel(p.userAgent), since: p.createdAt.toISOString() })),
        ...pluginRows.map((p) => ({ kind: 'plugin' as const, label: 'Plugin', since: p.createdAt.toISOString() })),
      ],
      storageLimitBytes: MAX_STORAGE_PER_USER,
    });
  })

  // Blocking ends all sessions; logins, magic links and the person's share links stop working until unblocked
  .post('/users/:id/block', async (c) => {
    const db = c.get('db');
    const id = c.req.param('id');
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, id)).limit(1);
    if (!user) return c.json({ error: 'Not found' }, 404);
    if (isAdminEmail(user.email)) return c.json({ error: 'Admins lassen sich nicht sperren' }, 400);
    await db.transaction(async (tx) => {
      await tx.update(users).set({ blockedAt: new Date() }).where(eq(users.id, id));
      await tx.delete(sessions).where(eq(sessions.userId, id));
    });
    return c.json({ blocked: true });
  })

  .delete('/users/:id/block', async (c) => {
    await c.get('db').update(users).set({ blockedAt: null }).where(eq(users.id, c.req.param('id')));
    return c.json({ blocked: false });
  })

  // Links that are still valid or were opened in the last 30 days, with their newest listeners
  .get('/share-links', async (c) => {
    const db = c.get('db');
    const from = ts(new Date(Date.now() - 30 * DAY));
    const [links, listens] = await Promise.all([
      db.execute<{
        id: string;
        createdAt: string;
        expiresAt: string | null;
        hasPassword: boolean;
        allowDownload: boolean;
        trackName: string;
        versionNumber: number;
        duration: number | null;
        projectId: string;
        projectName: string;
        creatorId: string;
        creatorName: string;
        opens: number;
        plays: number;
        complete: number;
        guestComments: number;
      }>(sql`
        SELECT l.id, ${iso(sql.raw('l.created_at'))} AS "createdAt", ${iso(sql.raw('l.expires_at'))} AS "expiresAt",
          l.password_hash IS NOT NULL AS "hasPassword", l.allow_download AS "allowDownload",
          t.name AS "trackName", v.version_number AS "versionNumber", v.duration,
          p.id AS "projectId", p.name AS "projectName", l.created_by_id AS "creatorId", u.name AS "creatorName",
          count(e.id) FILTER (WHERE e.opened_at >= ${from})::int AS opens,
          count(e.first_play_at) FILTER (WHERE e.opened_at >= ${from})::int AS plays,
          count(e.id) FILTER (WHERE e.completed AND e.opened_at >= ${from})::int AS complete,
          (SELECT count(*)::int FROM comments c
            WHERE c.version_id = l.version_id AND c.user_id IS NULL
              AND c.created_at >= l.created_at AND c.created_at >= ${from}) AS "guestComments"
        FROM share_links l
        JOIN versions v ON v.id = l.version_id
        JOIN tracks t ON t.id = v.track_id
        JOIN projects p ON p.id = t.project_id
        JOIN users u ON u.id = l.created_by_id
        LEFT JOIN listen_events e ON e.share_link_id = l.id
        GROUP BY l.id, t.name, v.version_number, v.duration, p.id, p.name, u.name
        HAVING l.expires_at IS NULL OR l.expires_at > now() OR count(e.id) FILTER (WHERE e.opened_at >= ${from}) > 0
        ORDER BY opens DESC, l.created_at DESC
      `),
      db.execute<{
        linkId: string;
        guestName: string | null;
        userAgent: string | null;
        seconds: number;
        completed: boolean;
        played: boolean;
        at: string;
      }>(sql`
        SELECT "linkId", "guestName", "userAgent", seconds, completed, played, at FROM (
          SELECT e.share_link_id AS "linkId", e.listener_name AS "guestName", e.user_agent AS "userAgent",
            e.listen_seconds AS seconds, e.completed, e.first_play_at IS NOT NULL AS played,
            ${iso(sql.raw('e.opened_at'))} AS at,
            row_number() OVER (PARTITION BY e.share_link_id ORDER BY e.opened_at DESC) AS n
          FROM listen_events e
        ) x
        WHERE n <= 6
        ORDER BY at DESC
      `),
    ]);

    return c.json({
      links: links.map((l) => ({
        ...l,
        listeners: listens
          .filter((e) => e.linkId === l.id)
          .map(({ linkId, userAgent, ...e }) => ({ ...e, device: deviceLabel(userAgent) })),
      })),
    });
  })

  // Protokoll: everything that happened in a window of at most a month, newest first
  .get('/events', async (c) => {
    const to = parseDate(c.req.query('to')) ?? new Date();
    let from = parseDate(c.req.query('from')) ?? new Date(to.getTime() - 7 * DAY);
    if (to.getTime() - from.getTime() > 31 * DAY) from = new Date(to.getTime() - 31 * DAY);
    const events = await loadEvents(c.get('db'), { from, to });
    return c.json({ from: from.toISOString(), to: to.toISOString(), events });
  });
