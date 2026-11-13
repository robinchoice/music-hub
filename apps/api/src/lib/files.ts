import { sql } from 'drizzle-orm';
import { isAudioFile } from '@music-hub/shared';
import type { Database } from '@music-hub/db';

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

// An audio upload of any project: a file moved into another project keeps the key it was uploaded under
export const isAudioUploadKey = (fileKey: string) => /^projects\/[0-9a-f-]{36}\/uploads\/[0-9a-f-]{36}\/original\/[^/]+$/.test(fileKey);

// The one list of every column that points to a file in the bucket. Registering checks it so an upload counts once,
// deleting checks it so a file a row still needs stays. A new column holding keys belongs here, or its files get deleted.
// One statement, so a file moving between tables in a transaction is never missed.
export async function keysInUse(db: Pick<Database, 'execute'>, keys: string[]) {
  const used = new Set<string>();
  for (let i = 0; i < keys.length; i += 1000) {
    const list = sql.join(keys.slice(i, i + 1000).map((k) => sql`${k}`), sql`, `);
    const rows = await db.execute<{ key: string }>(sql`
      SELECT k.key FROM unnest(ARRAY[${list}]::text[]) AS k(key)
      WHERE k.key IN (SELECT original_file_key FROM versions)
         OR k.key IN (SELECT stream_file_key FROM versions WHERE stream_file_key IS NOT NULL)
         OR k.key IN (SELECT waveform_data_key FROM versions WHERE waveform_data_key IS NOT NULL)
         OR k.key IN (SELECT file_key FROM stems)
         OR k.key IN (SELECT file_key FROM stem_revisions)
         OR k.key IN (SELECT file_key FROM project_files)
         OR k.key IN (SELECT cover_image_url FROM projects WHERE cover_image_url IS NOT NULL)
         OR k.key IN (SELECT cover_image_url FROM tracks WHERE cover_image_url IS NOT NULL)
    `);
    for (const row of rows) used.add(row.key);
  }
  return used;
}

export const uploadKeyInUse = async (db: Pick<Database, 'execute'>, fileKey: string) => (await keysInUse(db, [fileKey])).has(fileKey);

export { isAudioFile };

// Audio a browser can play from the bucket; everything else is only offered as a download
export const playableInline = (mimeType: string) => /^audio\/(wav|x-wav|wave|mpeg|mp3|mp4|x-m4a|aac|ogg|flac|x-flac|webm)$/.test(mimeType);
