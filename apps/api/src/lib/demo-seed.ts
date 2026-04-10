/**
 * Lightweight demo seed used by the onboarding endpoint.
 * Creates one project with one track and three versions, plus a comment and a share link.
 *
 * Audio source: a synthetic WAV is generated on demand via FFmpeg if no asset is found,
 * so this works regardless of whether the rich seed assets exist on disk.
 */
import {
  projects,
  projectMembers,
  tracks,
  versions,
  comments,
  shareLinks,
  type Database,
} from '@music-hub/db';
import { createUploadUrl } from '../storage/s3.js';
import { processVersion } from '../services/audio-processor.js';

const ASSET_DIR = '/tmp/musichub-seed';

async function getDemoAudio(name: string, frequency: number, duration: number): Promise<ArrayBuffer> {
  const f = Bun.file(`${ASSET_DIR}/${name}`);
  if (await f.exists()) return await f.arrayBuffer();

  // Synthesize on the fly with ffmpeg
  const tmp = `/tmp/musichub-onb-${crypto.randomUUID()}.wav`;
  const proc = Bun.spawn([
    'ffmpeg',
    '-f', 'lavfi',
    '-i', `sine=frequency=${frequency}:duration=${duration}`,
    '-ac', '2', '-ar', '44100',
    '-v', 'quiet',
    '-y',
    tmp,
  ]);
  await proc.exited;
  const bytes = await Bun.file(tmp).arrayBuffer();
  await Bun.spawn(['rm', tmp]).exited;
  return bytes;
}

async function uploadAudio(
  bytes: ArrayBuffer,
  projectId: string,
  trackId: string,
  versionId: string,
  filename: string,
): Promise<string> {
  const fileKey = `projects/${projectId}/tracks/${trackId}/versions/${versionId}/original/${filename}`;
  const uploadUrl = await createUploadUrl(fileKey, 'audio/wav', bytes.byteLength);
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'audio/wav' },
    body: bytes,
  });
  if (!res.ok) throw new Error(`Audio upload failed: ${res.status}`);
  return fileKey;
}

export async function createDemoProject(db: Database, userId: string): Promise<string> {
  // Project
  const [project] = await db
    .insert(projects)
    .values({
      name: 'Mein erstes Projekt',
      description: 'Ein kleines Demo-Projekt zum Ausprobieren. Du kannst es jederzeit löschen.',
      createdById: userId,
    })
    .returning();

  await db.insert(projectMembers).values({
    projectId: project.id,
    userId,
    role: 'owner',
    canUpload: true,
    canComment: true,
    canApprove: true,
  });

  // Track
  const [track] = await db
    .insert(tracks)
    .values({
      projectId: project.id,
      name: 'Demo-Track',
      description: 'Drei Versionen mit Comments und einer Variante.',
      status: 'in_progress',
      createdById: userId,
    })
    .returning();

  // Versions
  const versionDefs = [
    { label: 'Erster Wurf', frequency: 220, duration: 8, file: 'demo-v1.wav' },
    { label: 'Mehr Bass', frequency: 110, duration: 8, file: 'demo-v2.wav' },
    { label: 'Final Mix', frequency: 330, duration: 8, file: 'demo-v3.wav' },
  ];

  const createdVersionIds: string[] = [];

  for (let i = 0; i < versionDefs.length; i++) {
    const v = versionDefs[i];
    const versionId = crypto.randomUUID();
    const bytes = await getDemoAudio(v.file, v.frequency, v.duration);
    const fileKey = await uploadAudio(bytes, project.id, track.id, versionId, v.file);

    const [version] = await db
      .insert(versions)
      .values({
        id: versionId,
        trackId: track.id,
        versionNumber: i + 1,
        label: v.label,
        status: 'uploaded',
        originalFileName: v.file,
        mimeType: 'audio/wav',
        fileSize: bytes.byteLength,
        originalFileKey: fileKey,
        createdById: userId,
      })
      .returning();

    createdVersionIds.push(version.id);
    // Process synchronously so the player has a waveform when the user lands.
    await processVersion(db, version.id);
  }

  // Comments on V2
  await db.insert(comments).values([
    {
      versionId: createdVersionIds[1],
      userId,
      body: 'Klick auf die Welle bei einer beliebigen Stelle, um einen Kommentar mit Timestamp zu schreiben.',
      timestampSeconds: 2.5,
    },
    {
      versionId: createdVersionIds[1],
      userId: null,
      guestName: 'Demo-Listener',
      body: 'So sieht es aus, wenn jemand ohne Account über einen geteilten Link kommentiert.',
      timestampSeconds: 5.0,
    },
  ]);

  // Share link on V3
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  await db.insert(shareLinks).values({
    versionId: createdVersionIds[2],
    token,
    createdById: userId,
    allowComments: true,
    allowDownload: false,
  });

  return project.id;
}
