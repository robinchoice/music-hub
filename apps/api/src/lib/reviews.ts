import { runInBackground } from './background.js';
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, notExists, sql, type SQL } from 'drizzle-orm';
import {
  comments,
  projectMembers,
  reviews,
  tracks,
  users,
  versions,
  type Database,
} from '@music-hub/db';
import { REJECTION_PREFIX, REVIEW_PASS_HOURS, REVIEW_QUIET_MINUTES, type ReviewVerdict } from '@music-hub/shared';
import { notifyUser } from '../services/push.js';
import { sendFeedbackEmail } from '../services/email.js';
import { membershipOf } from './access.js';
import { reachOf } from './users.js';
import { publish } from '../services/sse.js';
import { messages, type Messages } from './messages.js';

const QUIET = `${REVIEW_QUIET_MINUTES} minutes`;
const WINDOW = `${REVIEW_PASS_HOURS} hours`;

// A member, or a guest on a share link known only by name
export type Author = { userId: string } | { guestName: string };

type Version = typeof versions.$inferSelect;
type Track = typeof tracks.$inferSelect;

export const nameOf = async (db: Database, userId: string) =>
  (await db.select({ name: users.name }).from(users).where(eq(users.id, userId)))[0]?.name ?? 'Jemand';

function authorIs(table: typeof comments | typeof reviews, author: Author): SQL {
  return 'userId' in author
    ? eq(table.userId, author.userId)
    : and(isNull(table.userId), eq(table.guestName, author.guestName))!;
}

// The author's recent comments since their previous review on this version: the pass the next review closes
function passWhere(versionId: string, author: Author): SQL {
  const last = sql`(select max(${reviews.createdAt}) from ${reviews} where ${and(eq(reviews.versionId, versionId), authorIs(reviews, author))})`;
  return and(
    eq(comments.versionId, versionId),
    authorIs(comments, author),
    isNull(comments.deletedAt),
    sql`${comments.createdAt} > coalesce(${last}, '-infinity')`,
    sql`${comments.createdAt} > now() - ${WINDOW}::interval`,
  )!;
}

function passOf(db: Pick<Database, 'select'>, versionId: string, author: Author) {
  return db
    .select({ body: comments.body, timestampSeconds: comments.timestampSeconds })
    .from(comments)
    .where(passWhere(versionId, author))
    .orderBy(asc(comments.timestampSeconds), asc(comments.createdAt));
}

export async function submitReview(
  db: Database,
  input: { version: Version; track: Track; author: Author; authorName: string; verdict: ReviewVerdict; note?: string | null | undefined; canApprove: boolean },
) {
  const { version, track, author, verdict, canApprove } = input;
  const note = input.note?.trim() || null;
  // Approving decides the version, and so does "Änderungen nötig" from someone who may approve
  const status = verdict === 'approve' ? 'approved' : verdict === 'changes' && canApprove ? 'rejected' : null;
  const { review, pass } = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('review-summaries'))`);
    const createdAt = new Date();
    const pass = await passOf(tx, version.id, author);
    if (status && 'userId' in author) {
      await tx
        .update(versions)
        .set({ status, decidedById: author.userId, decidedAt: createdAt })
        .where(eq(versions.id, version.id));
      if (status === 'rejected' && note) {
        await tx.insert(comments).values({ versionId: version.id, userId: author.userId, body: `${REJECTION_PREFIX}${note}`, createdAt });
      }
    }
    const [review] = await tx
      .insert(reviews)
      .values({
        versionId: version.id,
        userId: 'userId' in author ? author.userId : null,
        guestName: 'guestName' in author ? author.guestName : null,
        verdict,
        note,
        commentCount: pass.length,
        createdAt,
      })
      .returning();
    return { review, pass };
  });

  if (status) publish(db, track.id, { type: 'version:status', data: { versionId: version.id, status } });
  publish(db, track.id, { type: 'review:new', data: { versionId: version.id } });
  if (!('userId' in author) || author.userId !== version.createdById) {
    runInBackground(deliverFeedback(db, { version, track, authorName: 'guestName' in author ? `${input.authorName} (Gast)` : input.authorName, verdict, note, comments: pass }).catch((err) =>
      console.error('[Reviews] Delivery failed:', err),
    ));
  }
  return review;
}

function feedbackText(m: Messages, authorName: string, trackName: string, versionNumber: number, verdict: ReviewVerdict | null, count: number, note: string | null) {
  const text = m.review;
  const version = `${trackName} V${versionNumber}`;
  const notes = count === 0 ? null : text.notes(count);
  const quote = note ? text.quote(note.length > 80 ? `${note.slice(0, 79)}…` : note) : null;
  const parts = (...list: (string | null)[]) => list.filter(Boolean).join(' · ');
  switch (verdict) {
    case 'approve':
      return { title: text.approvedTitle(versionNumber), body: parts(text.approvedBody(authorName, version), notes, quote) };
    case 'fine':
      return { title: text.fineTitle(authorName, versionNumber), body: parts(version, notes, quote) };
    case 'changes':
      return { title: text.changesTitle(authorName), body: parts(version, notes, quote) };
    default:
      return { title: text.feedbackTitle(versionNumber), body: parts(text.feedbackBody(authorName, notes ?? text.noNotes, version), quote) };
  }
}

// One push to the uploader, or a mail if they have no push and haven't turned the mails off
async function deliverFeedback(
  db: Database,
  input: { version: Version; track: Track; authorName: string; verdict: ReviewVerdict | null; note: string | null; comments: { body: string; timestampSeconds: number | null }[] },
) {
  const { version, track } = input;
  // Only while the uploader is still in the project
  if (!(await membershipOf(db, track.projectId, version.createdById))) return;
  const { push, mail } = await reachOf(db, [version.createdById]);

  const text = (m: Messages) => feedbackText(m, input.authorName, track.name, version.versionNumber, input.verdict, input.comments.length, input.note);
  if (push.length) {
    await notifyUser(db, version.createdById, (m) => ({ projectId: track.projectId, trackId: track.id, ...text(m), url: `/projects/${track.projectId}/tracks/${track.id}?v=${version.id}` }));
  } else if (mail.length) {
    await sendFeedbackEmail(mail[0].email, mail[0].mailToken, {
      title: text(messages[mail[0].locale]).title,
      projectId: track.projectId,
      trackId: track.id,
      trackName: track.name,
      versionNumber: version.versionNumber,
      note: input.note,
      comments: input.comments,
    }, mail[0].locale);
  }
}

// Closes the passes nobody finished: one review without a verdict per author and version, written
// under a lock so two API instances never send the same summary.
export async function takeDueFeedback(db: Database) {
  return db.transaction(async (tx) => {
    const [{ locked }] = await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext('review-summaries')) as locked`);
    if (!locked) return [];

    // Candidate filtering must match passWhere; HAVING additionally requires a quiet pass.
    const due = await tx.execute<{ version_id: string; user_id: string | null; guest_name: string | null; n: number }>(sql`
      select c.version_id, c.user_id, c.guest_name, count(*)::int as n
      from ${comments} c
      join ${versions} v on v.id = c.version_id and v.deleted_at is null
      join ${tracks} t on t.id = v.track_id and t.deleted_at is null
      join ${projectMembers} pm on pm.project_id = t.project_id and pm.user_id = v.created_by_id
      where c.deleted_at is null
        and c.created_at > now() - ${WINDOW}::interval
        and (c.user_id is not null or c.guest_name is not null)
        and c.user_id is distinct from v.created_by_id
        and c.created_at > coalesce((
          select max(r.created_at) from ${reviews} r
          where r.version_id = c.version_id
            and (r.user_id = c.user_id or (c.user_id is null and r.user_id is null and r.guest_name = c.guest_name))
        ), '-infinity')
      group by c.version_id, c.user_id, c.guest_name
      having max(c.created_at) < now() - ${QUIET}::interval
    `);
    if (due.length === 0) return [];

    const taken: { versionId: string; author: Author; comments: Awaited<ReturnType<typeof passOf>> }[] = [];
    for (const row of due) {
      const author: Author = row.user_id ? { userId: row.user_id } : { guestName: row.guest_name! };
      const pass = await passOf(tx, row.version_id, author);
      await tx.insert(reviews).values({
        versionId: row.version_id,
        userId: row.user_id,
        guestName: row.user_id ? null : row.guest_name,
        verdict: null,
        commentCount: pass.length,
        createdAt: new Date(),
      });
      taken.push({ versionId: row.version_id, author, comments: pass });
    }
    return taken;
  });
}

export async function sendDueFeedback(db: Database) {
  for (const item of await takeDueFeedback(db)) {
    const [row] = await db
      .select({ version: versions, track: tracks })
      .from(versions)
      .innerJoin(tracks, eq(tracks.id, versions.trackId))
      .where(eq(versions.id, item.versionId));
    if (!row) continue;
    const authorName =
      'userId' in item.author
        ? await nameOf(db, item.author.userId)
        : `${item.author.guestName} (Gast)`;
    publish(db, row.track.id, { type: 'review:new', data: { versionId: item.versionId } });
    await deliverFeedback(db, { ...row, authorName, verdict: null, note: null, comments: item.comments }).catch((err) =>
      console.error('[Reviews] Delivery failed:', err),
    );
  }
}

// The reviews of a version, newest first, who may approve but hasn't given feedback yet, and who uploaded it
export async function reviewsOf(db: Database, version: Version, projectId: string) {
  const list = await db
    .select({
      id: reviews.id,
      verdict: reviews.verdict,
      note: reviews.note,
      commentCount: reviews.commentCount,
      createdAt: reviews.createdAt,
      guestName: reviews.guestName,
      user: { id: users.id, name: users.name, avatarUrl: users.avatarUrl },
    })
    .from(reviews)
    .leftJoin(users, eq(users.id, reviews.userId))
    .where(eq(reviews.versionId, version.id))
    .orderBy(desc(reviews.createdAt));

  const waiting = await db
    .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.canApprove, true),
        ne(projectMembers.userId, version.createdById),
        // An automatic summary sent their comments, but their verdict is still missing
        notExists(db.select().from(reviews).where(and(eq(reviews.versionId, version.id), eq(reviews.userId, users.id), isNotNull(reviews.verdict)))),
      ),
    )
    .orderBy(asc(users.name));

  const [uploader] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, version.createdById));
  return { reviews: list, waiting, uploader: uploader ?? null };
}

// Undoing an approval takes back its verdict. Comments and note already reached the uploader, so a review
// that carried them stays without a verdict; otherwise its pass would open again and go out a second time.
export async function withdrawApproval(db: Database, versionId: string, userId: string) {
  const [review] = await db
    .select()
    .from(reviews)
    .where(and(eq(reviews.versionId, versionId), eq(reviews.userId, userId), eq(reviews.verdict, 'approve')))
    .orderBy(desc(reviews.createdAt))
    .limit(1);
  if (!review) return;
  if (review.commentCount === 0 && review.note === null) {
    await db.delete(reviews).where(eq(reviews.id, review.id));
  } else {
    await db.update(reviews).set({ verdict: null }).where(eq(reviews.id, review.id));
  }
}

// The note of the newest "Änderungen nötig" per version, shown as the reason of a rejected version
export async function changeNotes(db: Database, versionIds: string[]) {
  if (versionIds.length === 0) return new Map<string, string | null>();
  const rows = await db
    .selectDistinctOn([reviews.versionId], { versionId: reviews.versionId, note: reviews.note })
    .from(reviews)
    .innerJoin(versions, and(eq(versions.id, reviews.versionId), eq(versions.decidedById, reviews.userId)))
    .where(and(inArray(reviews.versionId, versionIds), eq(reviews.verdict, 'changes'), sql`${reviews.createdAt} <= ${versions.decidedAt}`))
    .orderBy(reviews.versionId, desc(reviews.createdAt));
  return new Map(rows.map((row) => [row.versionId, row.note]));
}
