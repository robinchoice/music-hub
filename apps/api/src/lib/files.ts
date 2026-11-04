import { eq } from 'drizzle-orm';
import { projectFiles, stemRevisions, stems, versions, type Database } from '@music-hub/db';

// Keys from the project's upload URL (/files/project/:id/upload-url): one upload, and the client decides
// afterwards whether it becomes a version, a stem or a file of the project
export const projectUploadPrefix = (projectId: string) => `projects/${projectId}/uploads/`;

export function isProjectUploadKey(projectId: string, fileKey: string) {
  const prefix = projectUploadPrefix(projectId);
  return fileKey.startsWith(prefix) && /^[0-9a-f-]{36}\/original\/[^/]+$/.test(fileKey.slice(prefix.length));
}

// Whether a version, a stem, an earlier file of a stem or a file of a project points to the key,
// so one upload is registered only once
export async function uploadKeyInUse(db: Pick<Database, 'select'>, fileKey: string) {
  const [versionRef] = await db.select({ id: versions.id }).from(versions).where(eq(versions.originalFileKey, fileKey)).limit(1);
  const [stemRef] = await db.select({ id: stems.id }).from(stems).where(eq(stems.fileKey, fileKey)).limit(1);
  const [revisionRef] = await db.select({ id: stemRevisions.id }).from(stemRevisions).where(eq(stemRevisions.fileKey, fileKey)).limit(1);
  const [fileRef] = await db.select({ id: projectFiles.id }).from(projectFiles).where(eq(projectFiles.fileKey, fileKey)).limit(1);
  return !!versionRef || !!stemRef || !!revisionRef || !!fileRef;
}

// Audio a browser can play from the bucket; everything else is only offered as a download
export const playableInline = (mimeType: string) => /^audio\/(wav|x-wav|wave|mpeg|mp3|mp4|x-m4a|aac|ogg|flac|x-flac|webm)$/.test(mimeType);
