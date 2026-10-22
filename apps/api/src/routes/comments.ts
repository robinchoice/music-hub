import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, and, asc, isNull } from 'drizzle-orm';
import { createCommentSchema, updateCommentSchema, reactionSchema, TRASH_DAYS } from '@music-hub/shared';
import { comments, users, type Database } from '@music-hub/db';
import { requireAuth } from '../middleware/auth.js';
import { publish } from '../services/sse.js';
import { reviewsOf } from '../lib/reviews.js';
import { reactionsOf, toggleReaction } from '../lib/reactions.js';
import { versionAccess } from '../lib/access.js';
import type { AppEnv } from '../types.js';

// The user's own comment with their membership, as long as the comment and its version are live.
// Who left the project (or lost the right to comment) can no longer change what they wrote.
async function ownComment(db: Database, commentId: string, userId: string) {
  const [comment] = await db
    .select()
    .from(comments)
    .where(and(eq(comments.id, commentId), eq(comments.userId, userId), isNull(comments.deletedAt)))
    .limit(1);
  if (!comment) return null;
  const found = await versionAccess(db, comment.versionId, userId);
  return found ? { ...comment, membership: found.membership } : null;
}

// A reply answers a live top-level comment of the same version; threads stay one level deep
export async function replyTarget(db: Database, parentId: string, versionId: string) {
  const [parent] = await db
    .select({ parentId: comments.parentId })
    .from(comments)
    .where(and(eq(comments.id, parentId), eq(comments.versionId, versionId), isNull(comments.deletedAt)))
    .limit(1);
  if (!parent) return Response.json({ error: 'Comment not found' }, { status: 404 });
  if (parent.parentId) return Response.json({ error: 'Replies answer a comment, not a reply' }, { status: 400 });
  return parent;
}

export const commentRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  // Get comments for a version
  .get('/version/:versionId', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const versionId = c.req.param('versionId');

    const found = await versionAccess(db, versionId, userId);
    if (!found) return c.json({ error: 'Not found' }, 404);
    const { version, track, membership } = found;

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
    const shown = rows.filter((r) => !r.deletedAt || (!r.parentId && answered.has(r.id)));
    const reactions = await reactionsOf(db, shown.filter((r) => !r.deletedAt).map((r) => r.id));
    const versionComments = shown.map(({ discardedAt, ...r }) => {
      if (!r.deletedAt) return { ...r, reactions: reactions.get(r.id) ?? [] };
      const mine = r.user?.id === userId;
      return {
        ...r,
        body: '',
        guestName: null,
        user: mine ? r.user : null,
        restorable: mine && !discardedAt && r.deletedAt.getTime() > trashCutoff,
        reactions: [],
      };
    });

    if (c.req.query('commentsOnly') === 'true') return c.json({ comments: versionComments });

    // Who finished listening, and with which verdict, travels with the comments it closes
    return c.json({ comments: versionComments, ...(await reviewsOf(db, version, track!.projectId)) });
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

      const found = await versionAccess(db, versionId, userId);
      if (!found) return c.json({ error: 'Not found' }, 404);
      const { track, membership } = found;

      if (!membership || !membership.canComment) {
        return c.json({ error: 'Forbidden' }, 403);
      }
      if (input.parentId) {
        const parent = await replyTarget(db, input.parentId, versionId);
        if (parent instanceof Response) return parent;
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

      publish(db, track!.id, { type: 'comment:new', data: { versionId, commentId: comment.id } });

      return c.json({ comment }, 201);
    },
  )

  // Update comment
  .patch('/:id', zValidator('json', updateCommentSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const commentId = c.req.param('id');
    const input = c.req.valid('json');

    const comment = await ownComment(db, commentId, userId);
    if (!comment) return c.json({ error: 'Not found' }, 404);
    if (!comment.membership?.canComment) return c.json({ error: 'Forbidden' }, 403);

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

    const comment = await ownComment(db, commentId, userId);
    if (!comment) return c.json({ error: 'Not found' }, 404);
    if (!comment.membership?.canComment) return c.json({ error: 'Forbidden' }, 403);

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

    const found = await versionAccess(db, comment.versionId, userId);
    if (!found) return c.json({ error: 'Not found' }, 404);
    const { track, membership } = found;

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

  // React with an emoji, or take the reaction back. Sends no push and no mail.
  .post('/:id/reactions', zValidator('json', reactionSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const commentId = c.req.param('id');
    const { emoji } = c.req.valid('json');

    const [comment] = await db
      .select()
      .from(comments)
      .where(and(eq(comments.id, commentId), isNull(comments.deletedAt)))
      .limit(1);
    if (!comment) return c.json({ error: 'Not found' }, 404);

    const found = await versionAccess(db, comment.versionId, userId);
    if (!found) return c.json({ error: 'Not found' }, 404);
    const { track, membership } = found;
    if (!membership) return c.json({ error: 'Not found' }, 404);
    if (!membership.canComment && !membership.canApprove) return c.json({ error: 'Forbidden' }, 403);

    const reacted = await toggleReaction(db, commentId, userId, emoji);
    publish(db, track!.id, { type: 'comment:reaction', data: { versionId: comment.versionId, commentId } });

    return c.json({ reacted, reactions: (await reactionsOf(db, [commentId])).get(commentId) ?? [] });
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

    const found = await versionAccess(db, comment.versionId, userId);
    if (!found) return c.json({ error: 'Not found' }, 404);
    const { track, membership } = found;

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
