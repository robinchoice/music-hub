import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, and, asc } from 'drizzle-orm';
import { createCommentSchema, updateCommentSchema } from '@music-hub/shared';
import { comments, versions, tracks, projectMembers, users } from '@music-hub/db';
import { requireAuth } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

export const commentRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  // Get comments for a version
  .get('/version/:versionId', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const versionId = c.req.param('versionId');

    const [version] = await db
      .select()
      .from(versions)
      .where(eq(versions.id, versionId))
      .limit(1);

    if (!version) return c.json({ error: 'Not found' }, 404);

    const [track] = await db
      .select()
      .from(tracks)
      .where(eq(tracks.id, version.trackId))
      .limit(1);

    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(
        and(eq(projectMembers.projectId, track!.projectId), eq(projectMembers.userId, userId)),
      )
      .limit(1);

    if (!membership) return c.json({ error: 'Not found' }, 404);

    const versionComments = await db
      .select({
        id: comments.id,
        body: comments.body,
        timestampSeconds: comments.timestampSeconds,
        parentId: comments.parentId,
        resolvedAt: comments.resolvedAt,
        createdAt: comments.createdAt,
        guestName: comments.guestName,
        user: {
          id: users.id,
          name: users.name,
          avatarUrl: users.avatarUrl,
        },
      })
      .from(comments)
      .leftJoin(users, eq(users.id, comments.userId))
      .where(eq(comments.versionId, versionId))
      .orderBy(asc(comments.createdAt));

    return c.json({ comments: versionComments });
  })

  // Create comment
  .post(
    '/version/:versionId',
    zValidator('json', createCommentSchema),
    async (c) => {
      const db = c.get('db');
      const userId = c.get('userId');
      const versionId = c.req.param('versionId');
      const input = c.req.valid('json');

      const [version] = await db
        .select()
        .from(versions)
        .where(eq(versions.id, versionId))
        .limit(1);

      if (!version) return c.json({ error: 'Not found' }, 404);

      const [track] = await db
        .select()
        .from(tracks)
        .where(eq(tracks.id, version.trackId))
        .limit(1);

      const [membership] = await db
        .select()
        .from(projectMembers)
        .where(
          and(eq(projectMembers.projectId, track!.projectId), eq(projectMembers.userId, userId)),
        )
        .limit(1);

      if (!membership || !membership.canComment) {
        return c.json({ error: 'Forbidden' }, 403);
      }

      const [comment] = await db
        .insert(comments)
        .values({
          versionId,
          userId,
          body: input.body,
          timestampSeconds: input.timestampSeconds,
          parentId: input.parentId,
        })
        .returning();

      return c.json({ comment }, 201);
    },
  )

  // Update comment
  .patch('/:id', zValidator('json', updateCommentSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const commentId = c.req.param('id');
    const input = c.req.valid('json');

    const [comment] = await db
      .select()
      .from(comments)
      .where(and(eq(comments.id, commentId), eq(comments.userId, userId)))
      .limit(1);

    if (!comment) return c.json({ error: 'Not found' }, 404);

    const [updated] = await db
      .update(comments)
      .set({ body: input.body, updatedAt: new Date() })
      .where(eq(comments.id, commentId))
      .returning();

    return c.json({ comment: updated });
  })

  // Delete comment
  .delete('/:id', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const commentId = c.req.param('id');

    const [comment] = await db
      .select()
      .from(comments)
      .where(and(eq(comments.id, commentId), eq(comments.userId, userId)))
      .limit(1);

    if (!comment) return c.json({ error: 'Not found' }, 404);

    await db.delete(comments).where(eq(comments.id, commentId));
    return c.json({ message: 'Comment deleted' });
  })

  // Resolve comment
  .post('/:id/resolve', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const commentId = c.req.param('id');

    const [comment] = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
    if (!comment) return c.json({ error: 'Not found' }, 404);

    const [version] = await db.select().from(versions).where(eq(versions.id, comment.versionId)).limit(1);
    const [track] = await db.select().from(tracks).where(eq(tracks.id, version!.trackId)).limit(1);
    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, track!.projectId), eq(projectMembers.userId, userId)))
      .limit(1);

    if (!membership || (!membership.canComment && !membership.canApprove)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const [updated] = await db
      .update(comments)
      .set({ resolvedAt: new Date() })
      .where(eq(comments.id, commentId))
      .returning();

    return c.json({ comment: updated });
  });
