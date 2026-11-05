import { eq } from 'drizzle-orm';
import { isAudioFile } from '@music-hub/shared';
import { projectFiles, stemRevisions, stems, versions, type Database } from '@music-hub/db';

// Keys from the project's upload URL (/files/project/:id/upload-url): one upload, and the client decides
// afterwards whether it becomes a version, a stem or a file of the project
export const projectUploadPrefix = (projectId: string) => `projects/${projectId}/uploads/`;

// original/ holds what was uploaded as audio and may become a version or a stem. Anything else goes to file/ and
// stays a file of the project, so a type the browser would render never ends up in a player.
export function isProjectUploadKey(projectId: string, fileKey: string, folders: ('original' | 'file')[] = ['original']) {
  const prefix = projectUploadPrefix(projectId);
  const rest = fileKey.startsWith(prefix) ? fileKey.slice(prefix.length) : '';
  return folders.some((folder) => new RegExp(`^[0-9a-f-]{36}/${folder}/[^/]+$`).test(rest));
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

export { isAudioFile };

// Audio a browser can play from the bucket; everything else is only offered as a download
export const playableInline = (mimeType: string) => /^audio\/(wav|x-wav|wave|mpeg|mp3|mp4|x-m4a|aac|ogg|flac|x-flac|webm)$/.test(mimeType);
