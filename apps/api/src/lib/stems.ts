import { and, eq, isNull } from 'drizzle-orm';
import { stemRevisions, stems, type Database } from '@music-hub/db';
import { fits, lockStorage, storageOf } from './storage.js';

type Stem = typeof stems.$inferSelect;
type File = { originalFileName: string; mimeType: string; fileKey: string; fileSize: number; sha256?: string };

// The stem's current file as an entry of its history
const revisionOf = (stem: Stem, replacedAt: Date) => ({
  stemId: stem.id,
  originalFileName: stem.originalFileName,
  mimeType: stem.mimeType,
  fileSize: stem.fileSize,
  fileKey: stem.fileKey,
  sha256: stem.sha256,
  forked: stem.forked,
  createdById: stem.createdById,
  createdAt: stem.revisedAt ?? stem.createdAt,
  replacedAt,
});

// A key handed out by an upload URL route for this track that no stem uses yet
export async function freshStemKey(db: Pick<Database, 'select'>, track: { id: string; projectId: string }, fileKey: string) {
  const expectedPrefix = `projects/${track.projectId}/tracks/${track.id}/stems/`;
  const keySuffix = fileKey.slice(expectedPrefix.length);
  if (!fileKey.startsWith(expectedPrefix) || !/^[0-9a-f-]{36}\/[^/]+$/.test(keySuffix)) return false;

  const [stemRef] = await db.select({ id: stems.id }).from(stems).where(eq(stems.fileKey, fileKey)).limit(1);
  const [revisionRef] = await db
    .select({ id: stemRevisions.id })
    .from(stemRevisions)
    .where(eq(stemRevisions.fileKey, fileKey))
    .limit(1);
  return !stemRef && !revisionRef;
}

// Gives the stem a new file from the user; the current one moves into its history.
// Returns null if the file doesn't fit into the user's storage.
export async function replaceStem(db: Database, stemId: string, userId: string, file: File) {
  return db.transaction(async (tx) => {
    await lockStorage(tx, userId);
    if (!fits(await storageOf(tx, userId), file.fileSize)) return null;

    const [current] = await tx.select().from(stems).where(eq(stems.id, stemId)).for('update');
    const now = new Date();
    await tx.insert(stemRevisions).values(revisionOf(current, now));
    const [stem] = await tx
      .update(stems)
      .set({ ...file, sha256: file.sha256 ?? null, forked: false, createdById: userId, revisedAt: now })
      .where(eq(stems.id, stemId))
      .returning();
    return stem;
  });
}

// Makes an earlier file current again; the current one moves into the history.
// The storage stays the same, both files were counted already. Returns null if the revision is gone or in the trash.
export async function restoreRevision(db: Database, revisionId: string) {
  return db.transaction(async (tx) => {
    const [revision] = await tx
      .select()
      .from(stemRevisions)
      .where(and(eq(stemRevisions.id, revisionId), isNull(stemRevisions.deletedAt)));
    if (!revision) return null;
    const [current] = await tx.select().from(stems).where(eq(stems.id, revision.stemId)).for('update');
    const [restored] = await tx.delete(stemRevisions).where(eq(stemRevisions.id, revisionId)).returning();
    if (!restored) return null;

    const now = new Date();
    await tx.insert(stemRevisions).values(revisionOf(current, now));
    const [stem] = await tx
      .update(stems)
      .set({
        originalFileName: restored.originalFileName,
        mimeType: restored.mimeType,
        fileSize: restored.fileSize,
        fileKey: restored.fileKey,
        sha256: restored.sha256,
        forked: restored.forked,
        createdById: restored.createdById,
        revisedAt: now,
      })
      .where(eq(stems.id, current.id))
      .returning();
    return stem;
  });
}
