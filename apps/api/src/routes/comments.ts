import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, and, asc, isNull } from 'drizzle-orm';
import { createCommentSchema, updateCommentSchema, TRASH_DAYS } from '@music-hub/shared';
import { comments, projectMembers, users } from '@music-hub/db';
import { requireAuth } from '../middleware/auth.js';
import { publish } from '../services/sse.js';
import { liveVersion } from '../lib/trash.js';
import type { AppEnv } from '../types.js';

export const commentRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  // Get comments for a version
  .get('/version/:versionId', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const versionId = c.req.param('versionId');

    const found = await liveVersion(db, versionId);
    if (!found) return c.json({ error: 'Not found' }, 404);
    const { track } = found;

    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(
        and(eq(projectMembers.projectId, track!.projectId), eq(projectMembers.userId, userId)),
      )
      .limit(1);

    if (!membership) return c.json({ error: 'Not found' }, 404);

    const rows = await db
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
        deletedAt: comments.deletedAt,
        discardedAt: comments.discardedAt,
      })
      .from(comments)
      .leftJoin(users, eq(users.id, comments.userId))
      .where(eq(comments.versionId, versionId))
      .orderBy(asc(comments.createdAt));

    // A deleted comment that still has replies stays as an empty placeholder, so the replies keep their thread.
    // Only its author sees who wrote it, and may restore it while it is in the trash.
    const answered = new Set(rows.filter((r) => !r.deletedAt && r.parentId).map((r) => r.parentId));
    const trashCutoff = Date.now() - TRASH_DAYS * 86_400_000;
    const versionComments = rows
      .filter((r) => !r.deletedAt || (!r.parentId && answered.has(r.id)))
      .map(({ discardedAt, ...r }) => {
        if (!r.deletedAt) return r;
        const mine = r.user?.id === userId;
        return {
          ...r,
          body: '',
          guestName: null,
          user: mine ? r.user : null,
          restorable: mine && !discardedAt && r.deletedAt.getTime() > trashCutoff,
        };
      });

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

      const found = await liveVersion(db, versionId);
      if (!found) return c.json({ error: 'Not found' }, 404);
      const { track } = found;

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

      publish(track!.id, { type: 'comment:new', data: { versionId, commentId: comment.id } });

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
      .where(and(eq(comments.id, commentId), eq(comments.userId, userId), isNull(comments.deletedAt)))
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
      .where(and(eq(comments.id, commentId), eq(comments.userId, userId), isNull(comments.deletedAt)))
      .limit(1);

    if (!comment) return c.json({ error: 'Not found' }, 404);

    // Into the project's trash; replies stay visible under a placeholder
    await db.update(comments).set({ deletedAt: new Date(), deletedById: userId }).where(eq(comments.id, commentId));
    return c.json({ message: 'Comment deleted' });
  })

  // Resolve comment
  .post('/:id/resolve', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const commentId = c.req.param('id');

    const [comment] = await db
      .select()
      .from(comments)
      .where(and(eq(comments.id, commentId), isNull(comments.deletedAt)))
      .limit(1);
    if (!comment) return c.json({ error: 'Not found' }, 404);

    const found = await liveVersion(db, comment.versionId);
    if (!found) return c.json({ error: 'Not found' }, 404);
    const { track } = found;
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
  })

  // Reopen a resolved comment
  .post('/:id/reopen', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const commentId = c.req.param('id');

    const [comment] = await db
      .select()
      .from(comments)
      .where(and(eq(comments.id, commentId), isNull(comments.deletedAt)))
      .limit(1);
    if (!comment) return c.json({ error: 'Not found' }, 404);

    const found = await liveVersion(db, comment.versionId);
    if (!found) return c.json({ error: 'Not found' }, 404);
    const { track } = found;
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
      .set({ resolvedAt: null })
      .where(eq(comments.id, commentId))
      .returning();

    return c.json({ comment: updated });
  });
