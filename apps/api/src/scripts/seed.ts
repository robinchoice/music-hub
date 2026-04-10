/**
 * Demo seed script.
 *
 * Usage:
 *   ffmpeg -f lavfi -i "sine=frequency=440:duration=8" -ac 2 /tmp/musichub-demo.wav
 *   bun run apps/api/src/scripts/seed.ts demo@example.com [/tmp/musichub-demo.wav]
 *
 * Creates user (if missing), a demo project with 1 track and 3 versions
 * (V2 mainline, V3 as branch off V2), 2 sample comments and 1 share link.
 */
import { eq } from 'drizzle-orm';
import { createDb, users, projects, projectMembers, tracks, versions, comments, shareLinks } from '@music-hub/db';
import { createUploadUrl } from '../storage/s3.js';
import { processVersion } from '../services/audio-processor.js';

const email = process.argv[2];
const audioPath = process.argv[3] || '/tmp/musichub-demo.wav';

if (!email) {
  console.error('Usage: bun run seed.ts <email> [audioPath]');
  process.exit(1);
}

const audioFile = Bun.file(audioPath);
if (!(await audioFile.exists())) {
  console.error(`Audio file missing: ${audioPath}`);
  console.error('Generate one first:');
  console.error(`  ffmpeg -f lavfi -i "sine=frequency=440:duration=8" -ac 2 ${audioPath}`);
  process.exit(1);
}
const audioBytes = await audioFile.arrayBuffer();
const audioSize = audioBytes.byteLength;

const db = createDb(process.env.DATABASE_URL!);

console.log(`→ User ${email}`);
let [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
if (!user) {
  [user] = await db.insert(users).values({ email, name: email.split('@')[0] }).returning();
  console.log(`  created ${user.id}`);
} else {
  console.log(`  exists ${user.id}`);
}

console.log('→ Projekt "Demo: Sunset Drive"');
const [project] = await db
  .insert(projects)
  .values({
    name: 'Demo: Sunset Drive',
    description: 'Synthwave-Track in Arbeit. Probier den Graph, lade eine neue Variante hoch oder teile den Link.',
    createdById: user.id,
  })
  .returning();

await db.insert(projectMembers).values({
  projectId: project.id,
  userId: user.id,
  role: 'owner',
  canUpload: true,
  canComment: true,
  canApprove: true,
});

console.log('→ Track "Hauptmix"');
const [track] = await db
  .insert(tracks)
  .values({
    projectId: project.id,
    name: 'Hauptmix',
    description: 'Der Hauptmix mit zwei Mainline-Versionen und einer Vocals-Variante.',
    createdById: user.id,
  })
  .returning();

async function uploadVersion(opts: {
  versionNumber: number;
  label: string;
  parentVersionId?: string | null;
  branchLabel?: string | null;
}) {
  const versionId = crypto.randomUUID();
  const fileName = `demo-v${opts.versionNumber}.wav`;
  const fileKey = `projects/${project.id}/tracks/${track.id}/versions/${versionId}/original/${fileName}`;

  const uploadUrl = await createUploadUrl(fileKey, 'audio/wav', audioSize);
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'audio/wav' },
    body: audioBytes,
  });
  if (!res.ok) throw new Error(`S3 upload failed: ${res.status} ${await res.text()}`);

  const [version] = await db
    .insert(versions)
    .values({
      id: versionId,
      trackId: track.id,
      versionNumber: opts.versionNumber,
      label: opts.label,
      status: 'uploaded',
      parentVersionId: opts.parentVersionId ?? null,
      branchLabel: opts.branchLabel ?? null,
      originalFileName: fileName,
      mimeType: 'audio/wav',
      fileSize: audioSize,
      originalFileKey: fileKey,
      createdById: user.id,
    })
    .returning();

  console.log(`  V${opts.versionNumber} (${opts.branchLabel ?? 'main'}) → processing`);
  await processVersion(db, version.id);
  return version;
}

const v1 = await uploadVersion({ versionNumber: 1, label: 'Erster Wurf' });
const v2 = await uploadVersion({ versionNumber: 2, label: 'Mehr Bass' });
const v3 = await uploadVersion({
  versionNumber: 3,
  label: 'Vocals neu',
  parentVersionId: v2.id,
  branchLabel: 'vocals-neu',
});

console.log('→ Comments');
await db.insert(comments).values([
  {
    versionId: v2.id,
    userId: user.id,
    body: 'Bei 0:03 sitzt der Drop, finde ich richtig stark.',
    timestampSeconds: 3.0,
  },
  {
    versionId: v2.id,
    userId: null,
    guestName: 'Anna (Artist)',
    body: 'Können wir die Vocals etwas weiter nach vorne ziehen?',
    timestampSeconds: 5.5,
  },
]);

console.log('→ Share-Link');
const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
  b.toString(16).padStart(2, '0'),
).join('');
await db.insert(shareLinks).values({
  versionId: v2.id,
  token,
  createdById: user.id,
  allowComments: true,
  allowDownload: false,
});

console.log('\n✅ Done.');
console.log(`   Login als ${email} via Magic Link.`);
console.log(`   Share-Link: http://localhost:5173/listen/${token}`);

await new Promise((r) => setTimeout(r, 200));
process.exit(0);
