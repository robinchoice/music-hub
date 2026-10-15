import { and, asc, eq, inArray } from 'drizzle-orm';
import { COMMENT_REACTIONS, type CommentReaction } from '@music-hub/shared';
import { commentReactions, users, type Database } from '@music-hub/db';

export type ReactionGroup = { emoji: string; users: { id: string; name: string }[] };

/** Reactions per comment, grouped by emoji in the order of the picker, people in the order they reacted. */
export async function reactionsOf(db: Database, commentIds: string[]) {
  const byComment = new Map<string, ReactionGroup[]>();
  if (commentIds.length === 0) return byComment;
  const rows = await db
    .select({ commentId: commentReactions.commentId, emoji: commentReactions.emoji, id: users.id, name: users.name })
    .from(commentReactions)
    .innerJoin(users, eq(users.id, commentReactions.userId))
    .where(inArray(commentReactions.commentId, commentIds))
    .orderBy(asc(commentReactions.createdAt));
  for (const emoji of COMMENT_REACTIONS) {
    for (const r of rows.filter((x) => x.emoji === emoji)) {
      const groups = byComment.get(r.commentId) ?? [];
      let group = groups.find((g) => g.emoji === emoji);
      if (!group) groups.push((group = { emoji, users: [] }));
      group.users.push({ id: r.id, name: r.name });
      byComment.set(r.commentId, groups);
    }
  }
  return byComment;
}

/** Adds the reaction, or takes it back when the person already reacted with this emoji. */
export async function toggleReaction(db: Database, commentId: string, userId: string, emoji: CommentReaction) {
  const [added] = await db
    .insert(commentReactions)
    .values({ commentId, userId, emoji })
    .onConflictDoNothing()
    .returning({ id: commentReactions.id });
  if (!added) {
    await db
      .delete(commentReactions)
      .where(and(eq(commentReactions.commentId, commentId), eq(commentReactions.userId, userId), eq(commentReactions.emoji, emoji)));
  }
  return !!added;
}
