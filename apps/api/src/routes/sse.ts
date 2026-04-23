import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { tracks, projectMembers } from '@music-hub/db';
import { requireAuth } from '../middleware/auth.js';
import { subscribe } from '../services/sse.js';
import type { AppEnv } from '../types.js';

export const sseRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/track/:trackId', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const trackId = c.req.param('trackId');

    const [track] = await db.select().from(tracks).where(eq(tracks.id, trackId)).limit(1);
    if (!track) return c.json({ error: 'Not found' }, 404);

    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, track.projectId), eq(projectMembers.userId, userId)))
      .limit(1);
    if (!membership) return c.json({ error: 'Forbidden' }, 403);

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    const send = (data: string) => writer.write(encoder.encode(data)).catch(() => {});
    const unsubscribe = subscribe(trackId, send);

    // Initial ping
    send(': connected\n\n');

    c.req.raw.signal.addEventListener('abort', () => {
      unsubscribe();
      writer.close().catch(() => {});
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  });
