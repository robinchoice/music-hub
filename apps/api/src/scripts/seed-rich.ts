/**
 * Reicher Demo-Seed: 4 Projekte mit verschiedenen Charakteren, mehreren Tracks,
 * Versionen, Mitgliedern, Comments und Share-Links.
 *
 * Voraussetzung: Audio-Dateien und Cover-PNGs liegen in /tmp/musichub-seed/
 *   bass.wav drums.wav hi.wav lead.wav mix.wav pad.wav vox.wav warm.wav
 *   sunset.png lichtjahre.png rooftop.png wave.png
 *
 * Usage:
 *   bun run apps/api/src/scripts/seed-rich.ts <email>
 */
import { eq } from 'drizzle-orm';
import {
  createDb,
  users,
  projects,
  projectMembers,
  tracks,
  versions,
  comments,
  shareLinks,
} from '@music-hub/db';
import { createUploadUrl } from '../storage/s3.js';
import { processVersion } from '../services/audio-processor.js';

const email = process.argv[2];
if (!email) {
  console.error('Usage: bun run seed-rich.ts <email>');
  process.exit(1);
}

const ASSET_DIR = '/tmp/musichub-seed';

async function readBytes(name: string): Promise<ArrayBuffer> {
  const f = Bun.file(`${ASSET_DIR}/${name}`);
  if (!(await f.exists())) throw new Error(`Missing asset: ${name}`);
  return await f.arrayBuffer();
}

const db = createDb(process.env.DATABASE_URL!);

// === USER SETUP ===
console.log(`→ User ${email}`);
let [me] = await db.select().from(users).where(eq(users.email, email)).limit(1);
if (!me) {
  [me] = await db.insert(users).values({ email, name: email.split('@')[0] }).returning();
  console.log(`  created ${me.id}`);
} else {
  console.log(`  exists ${me.id}`);
}

// Co-Mitglieder
const memberDefs = [
  { email: 'anna@example.com', name: 'Anna Berger', role: 'artist' as const },
  { email: 'jonas@example.com', name: 'Jonas Klein', role: 'mixing_engineer' as const },
  { email: 'lina@example.com', name: 'Lina Roth', role: 'mastering_engineer' as const },
  { email: 'felix@example.com', name: 'Felix Lang', role: 'label' as const },
];

const collaborators: Record<string, typeof users.$inferSelect> = {};
for (const m of memberDefs) {
  let [u] = await db.select().from(users).where(eq(users.email, m.email)).limit(1);
  if (!u) [u] = await db.insert(users).values({ email: m.email, name: m.name }).returning();
  collaborators[m.email] = u;
}
console.log(`→ ${memberDefs.length} Mitwirkende vorbereitet`);

// === COVER UPLOAD HELPER ===
async function uploadCover(filename: string): Promise<string> {
  const bytes = await readBytes(filename);
  const key = `covers/${crypto.randomUUID()}.png`;
  const url = await createUploadUrl(key, 'image/png', bytes.byteLength);
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/png' },
    body: bytes,
  });
  if (!res.ok) throw new Error(`Cover upload failed: ${res.status}`);
  return key;
}

// === PROJECT FACTORY ===
type TrackSpec = {
  name: string;
  description?: string;
  versions: VersionSpec[];
  comments?: CommentSpec[];
};
type VersionSpec = {
  label: string;
  audio: string;
  status?: 'ready' | 'approved' | 'rejected';
  parentLabel?: string;
  branchLabel?: string;
  notes?: string;
  createdBy?: string;
};
type CommentSpec = {
  versionLabel: string;
  body: string;
  at?: number;
  by?: string; // email or 'guest:Name'
};
type ProjectSpec = {
  name: string;
  description: string;
  cover: string;
  members: { email: string; role: any }[];
  tracks: TrackSpec[];
  shareVersionLabel?: { trackName: string; versionLabel: string };
};

async function createProject(spec: ProjectSpec) {
  console.log(`\n📀 ${spec.name}`);
  const coverKey = await uploadCover(spec.cover);
  const [project] = await db
    .insert(projects)
    .values({
      name: spec.name,
      description: spec.description,
      coverImageUrl: coverKey,
      createdById: me.id,
    })
    .returning();

  await db.insert(projectMembers).values({
    projectId: project.id,
    userId: me.id,
    role: 'owner',
    canUpload: true,
    canComment: true,
    canApprove: true,
  });

  for (const m of spec.members) {
    const u = collaborators[m.email];
    if (!u) continue;
    await db.insert(projectMembers).values({
      projectId: project.id,
      userId: u.id,
      role: m.role,
      canUpload: m.role.includes('engineer') || m.role === 'owner',
      canComment: true,
      canApprove: m.role === 'artist' || m.role === 'label' || m.role === 'management',
    });
  }

  let shareToken: string | null = null;

  for (const trackSpec of spec.tracks) {
    const [track] = await db
      .insert(tracks)
      .values({
        projectId: project.id,
        name: trackSpec.name,
        description: trackSpec.description,
        createdById: me.id,
      })
      .returning();
    console.log(`  🎵 ${trackSpec.name}`);

    // Versionen in Reihenfolge anlegen, parent-Lookup über Label
    const versionMap = new Map<string, string>();

    for (let i = 0; i < trackSpec.versions.length; i++) {
      const v = trackSpec.versions[i];
      const audioBytes = await readBytes(v.audio);
      const versionId = crypto.randomUUID();
      const fileName = `${v.audio}`;
      const fileKey = `projects/${project.id}/tracks/${track.id}/versions/${versionId}/original/${fileName}`;
      const uploadUrl = await createUploadUrl(fileKey, 'audio/wav', audioBytes.byteLength);
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'audio/wav' },
        body: audioBytes,
      });
      if (!res.ok) throw new Error(`Audio upload failed: ${res.status}`);

      const parentVersionId = v.parentLabel ? versionMap.get(v.parentLabel) ?? null : null;
      const createdById = v.createdBy
        ? collaborators[v.createdBy]?.id ?? me.id
        : me.id;

      const [version] = await db
        .insert(versions)
        .values({
          id: versionId,
          trackId: track.id,
          versionNumber: i + 1,
          label: v.label,
          notes: v.notes,
          status: 'uploaded',
          parentVersionId,
          branchLabel: v.branchLabel ?? null,
          originalFileName: fileName,
          mimeType: 'audio/wav',
          fileSize: audioBytes.byteLength,
          originalFileKey: fileKey,
          createdById,
        })
        .returning();

      versionMap.set(v.label, version.id);
      console.log(`    V${i + 1} ${v.label}${v.branchLabel ? ` (Variante: ${v.branchLabel})` : ''}`);
      await processVersion(db, version.id);

      if (v.status && v.status !== 'ready') {
        await db
          .update(versions)
          .set({ status: v.status })
          .where(eq(versions.id, version.id));
      }
    }

    // Comments
    for (const c of trackSpec.comments ?? []) {
      const versionId = versionMap.get(c.versionLabel);
      if (!versionId) continue;
      const isGuest = c.by?.startsWith('guest:');
      const userId = isGuest
        ? null
        : c.by
        ? collaborators[c.by]?.id ?? me.id
        : me.id;
      const guestName = isGuest ? c.by!.slice(6) : null;
      await db.insert(comments).values({
        versionId,
        userId,
        guestName,
        body: c.body,
        timestampSeconds: c.at ?? null,
      });
    }

    // Share-Link auf eine bestimmte Version
    if (
      spec.shareVersionLabel &&
      spec.shareVersionLabel.trackName === trackSpec.name
    ) {
      const versionId = versionMap.get(spec.shareVersionLabel.versionLabel);
      if (versionId) {
        const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
          b.toString(16).padStart(2, '0'),
        ).join('');
        await db.insert(shareLinks).values({
          versionId,
          token,
          createdById: me.id,
          allowComments: true,
          allowDownload: false,
        });
        shareToken = token;
      }
    }
  }

  if (shareToken) {
    console.log(`  🔗 Share: http://localhost:5173/listen/${shareToken}`);
  }
}

// === PROJEKT-KATALOG ===
await createProject({
  name: 'Sunset Drive',
  description: 'Synthwave-EP. Mainline ist V3, V4 ist eine Variante mit anderem Bass.',
  cover: 'sunset.png',
  members: [
    { email: 'anna@example.com', role: 'artist' },
    { email: 'jonas@example.com', role: 'mixing_engineer' },
    { email: 'lina@example.com', role: 'mastering_engineer' },
  ],
  tracks: [
    {
      name: 'Hauptmix',
      description: 'Der zentrale Track der EP. Drei Iterationen plus eine Vocal-Variante.',
      versions: [
        { label: 'Erster Wurf', audio: 'pad.wav' },
        { label: 'Mehr Bass', audio: 'bass.wav', notes: 'Sub etwas runter, Punch nach vorne' },
        { label: 'Final Mix', audio: 'mix.wav', status: 'approved', notes: 'Freigegeben von Lina nach Mastering' },
        { label: 'Andere Vocals', audio: 'vox.wav', parentLabel: 'Mehr Bass', branchLabel: 'vocals-alt', notes: 'Variante mit dem zweiten Vocal-Take', createdBy: 'jonas@example.com' },
      ],
      comments: [
        { versionLabel: 'Mehr Bass', at: 3.2, by: 'anna@example.com', body: 'Hier ist es nice — aber bei 0:05 fehlt mir noch was im Mid-Range.' },
        { versionLabel: 'Mehr Bass', at: 5.5, body: 'Verstanden, ziehe ich nach. EQ-Boost bei 800Hz.' },
        { versionLabel: 'Final Mix', at: 1.8, by: 'lina@example.com', body: 'Master sitzt. -1 LUFS, dynamic range bleibt erhalten.' },
        { versionLabel: 'Andere Vocals', at: 2.0, by: 'anna@example.com', body: 'Yes! Das ist die richtige Energie für den Refrain.' },
      ],
    },
    {
      name: 'Drums',
      description: 'Drum-Bus für den Hauptmix.',
      versions: [
        { label: 'Punchy', audio: 'drums.wav', createdBy: 'jonas@example.com' },
        { label: 'Mehr Air', audio: 'hi.wav', notes: 'Top-Hi-Hats lauter, Reverb-Tail dazu' },
      ],
      comments: [
        { versionLabel: 'Punchy', at: 1.5, by: 'anna@example.com', body: 'Snare ist perfekt hier.' },
      ],
    },
    {
      name: 'Lead Synth',
      description: 'Hauptmotiv. Sitzt zwischen Vox und Pad.',
      versions: [
        { label: 'V1', audio: 'lead.wav' },
      ],
    },
  ],
  shareVersionLabel: { trackName: 'Hauptmix', versionLabel: 'Final Mix' },
});

await createProject({
  name: 'Lichtjahre',
  description: 'Indie-Single. Acoustic-Demo, dann Studio-Take, dann Mix.',
  cover: 'lichtjahre.png',
  members: [
    { email: 'anna@example.com', role: 'artist' },
    { email: 'felix@example.com', role: 'label' },
  ],
  tracks: [
    {
      name: 'Lichtjahre',
      description: 'Hauptsong der Single.',
      versions: [
        { label: 'Acoustic Demo', audio: 'warm.wav', notes: 'Aufgenommen am Küchentisch' },
        { label: 'Studio Take', audio: 'pad.wav', notes: 'Voller Mix mit Band' },
        { label: 'Mix V1', audio: 'mix.wav', createdBy: 'jonas@example.com' },
      ],
      comments: [
        { versionLabel: 'Studio Take', at: 4.0, by: 'felix@example.com', body: 'Geht in die Richtung. Bei 0:08 könnten wir noch ein Break einbauen.' },
        { versionLabel: 'Studio Take', at: 7.2, body: 'Notiert.' },
        { versionLabel: 'Mix V1', at: 2.5, by: 'guest:Sarah (A&R)', body: 'Ich bin begeistert. Bei wann ist das fertig?' },
      ],
    },
    {
      name: 'B-Side',
      description: 'Instrumental-Version für Sync-Lizenz.',
      versions: [
        { label: 'Instrumental', audio: 'pad.wav' },
      ],
    },
  ],
  shareVersionLabel: { trackName: 'Lichtjahre', versionLabel: 'Mix V1' },
});

await createProject({
  name: 'Rooftop Session',
  description: 'Live-Aufnahme vom letzten Sommer-Gig. Soundcheck + ein Take pro Song.',
  cover: 'rooftop.png',
  members: [
    { email: 'jonas@example.com', role: 'recording_engineer' },
  ],
  tracks: [
    {
      name: 'Soundcheck',
      versions: [{ label: 'Take 1', audio: 'drums.wav', createdBy: 'jonas@example.com' }],
    },
    {
      name: 'Opener',
      versions: [
        { label: 'Live Take', audio: 'bass.wav' },
        { label: 'Roh-Mix', audio: 'mix.wav', notes: 'Schneller Mix für die Band-Doku' },
      ],
      comments: [
        { versionLabel: 'Live Take', at: 6.0, by: 'jonas@example.com', body: 'Crowd-Geräusche bewusst drin gelassen.' },
      ],
    },
    {
      name: 'Encore',
      versions: [{ label: 'Live Take', audio: 'lead.wav' }],
    },
  ],
});

await createProject({
  name: 'Wave Goodbye',
  description: 'Closing-Track für die EP. Noch früh in der Entwicklung.',
  cover: 'wave.png',
  members: [
    { email: 'anna@example.com', role: 'artist' },
  ],
  tracks: [
    {
      name: 'Skizze',
      versions: [{ label: 'V1', audio: 'pad.wav', notes: 'Erste Idee, sehr roh' }],
    },
  ],
});

console.log('\n✅ Fertig.');
console.log(`   Login als ${email} via Magic Link.`);
process.exit(0);
