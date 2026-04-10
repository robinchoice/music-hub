import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

type ActivityEvent = {
  type: 'comment' | 'version' | 'approval';
  id: string;
  createdAt: string;
  user: { id: string | null; name: string; avatarUrl: string | null } | null;
  guestName: string | null;
  project: { id: string; name: string };
  track: { id: string; name: string };
  version?: { id: string; versionNumber: number; label: string | null };
  body?: string;
  status?: string;
  timestampSeconds?: number | null;
};

export const activityRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const limit = Math.min(parseInt(c.req.query('limit') ?? '40'), 100);
    const projectFilter = c.req.query('projectId');

    // Helper: only events from projects the user is a member of.
    // We use raw sql for the UNION since drizzle's union builder is per-table-shape.
    const projectClause = projectFilter ? sql`AND p.id = ${projectFilter}` : sql``;

    const rows = await db.execute(sql`
      WITH membership AS (
        SELECT project_id FROM project_members WHERE user_id = ${userId}
      )
      SELECT * FROM (
        -- New versions
        SELECT
          'version' as type,
          v.id as event_id,
          v.created_at as created_at,
          u.id as user_id,
          u.name as user_name,
          u.avatar_url as user_avatar,
          NULL::text as guest_name,
          p.id as project_id,
          p.name as project_name,
          t.id as track_id,
          t.name as track_name,
          v.id as version_id,
          v.version_number as version_number,
          v.label as version_label,
          NULL::text as body,
          v.status::text as status,
          NULL::real as timestamp_seconds
        FROM versions v
        JOIN tracks t ON t.id = v.track_id
        JOIN projects p ON p.id = t.project_id
        JOIN membership m ON m.project_id = p.id
        LEFT JOIN users u ON u.id = v.created_by_id
        WHERE p.is_archived = false ${projectClause}

        UNION ALL

        -- New comments
        SELECT
          'comment' as type,
          c.id as event_id,
          c.created_at as created_at,
          u.id as user_id,
          u.name as user_name,
          u.avatar_url as user_avatar,
          c.guest_name as guest_name,
          p.id as project_id,
          p.name as project_name,
          t.id as track_id,
          t.name as track_name,
          v.id as version_id,
          v.version_number as version_number,
          v.label as version_label,
          c.body as body,
          NULL::text as status,
          c.timestamp_seconds as timestamp_seconds
        FROM comments c
        JOIN versions v ON v.id = c.version_id
        JOIN tracks t ON t.id = v.track_id
        JOIN projects p ON p.id = t.project_id
        JOIN membership m ON m.project_id = p.id
        LEFT JOIN users u ON u.id = c.user_id
        WHERE p.is_archived = false ${projectClause}
      ) events
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);

    const events: ActivityEvent[] = (rows as unknown as any[]).map((r) => ({
      type: r.type as ActivityEvent['type'],
      id: r.event_id,
      createdAt: typeof r.created_at === 'string' ? r.created_at : new Date(r.created_at).toISOString(),
      user: r.user_id
        ? { id: r.user_id, name: r.user_name, avatarUrl: r.user_avatar }
        : null,
      guestName: r.guest_name ?? null,
      project: { id: r.project_id, name: r.project_name },
      track: { id: r.track_id, name: r.track_name },
      version: r.version_id
        ? { id: r.version_id, versionNumber: r.version_number, label: r.version_label }
        : undefined,
      body: r.body ?? undefined,
      status: r.status ?? undefined,
      timestampSeconds: r.timestamp_seconds ?? null,
    }));

    return c.json({ events });
  });
