// Sample data and request handlers for the demo. They answer the requests of the real pages the way the API
// does, so the landing page can show the current frontend without a server. Changes stay in this browser window.
// When a page starts using a new endpoint, add it to ROUTES; missing ones are logged as "[Demo] … fehlt".
import type { TrackStatus } from '@music-hub/shared';
import type { TrackComment, Version } from '$lib/utils/track.js';

// UUIDs that gen_random_uuid() never produces, so a stray request to the API only gets a 404.
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const REJECTION_PREFIX = '❌ Abgelehnt: ';
const COVER = '/demo/nachtbus-cover.svg';

export const DEMO = {
  userId: uuid(1),
  projectId: uuid(10),
  trackId: uuid(20),
  trackPath: `/projects/${uuid(10)}/tracks/${uuid(20)}`,
  /** Length of the demo recordings in static/demo, in seconds */
  duration: 155,
};

type Person = { id: string; name: string; avatarUrl: string | null };
const MARA: Person = { id: uuid(1), name: 'Mara', avatarUrl: null };
const KAI: Person = { id: uuid(2), name: 'Kai', avatarUrl: null };
const LISA: Person = { id: uuid(3), name: 'Lisa', avatarUrl: null };
const JONAS: Person = { id: uuid(4), name: 'Jonas', avatarUrl: null };

type DemoProject = {
  id: string;
  name: string;
  description: string | null;
  artist: string | null;
  coverUrl: string | null;
  createdAt: string;
  updatedAt: string;
};
type DemoTrack = {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  coverUrl: string | null;
  status: TrackStatus;
  section: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};
type DemoVersion = Omit<Version, 'openCommentCount' | 'rejectionReason'> & {
  trackId: string;
  mimeType: string;
  fileSize: number;
  createdById: string;
  audio: string;
  integratedLufs: number;
};
type DemoComment = TrackComment & { versionId: string };
type DemoStem = {
  id: string;
  trackId: string;
  name: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
  createdById: string;
};

function seed() {
  const now = Date.now();
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  const HOUR = 60;
  const DAY = 24 * HOUR;

  const projects: DemoProject[] = [
    { id: uuid(10), name: 'Nachtbus EP', description: 'Vier Songs aus dem Proberaum.', artist: 'Fernlicht', coverUrl: COVER, createdAt: ago(30 * DAY), updatedAt: ago(2 * HOUR) },
    { id: uuid(11), name: 'Live im Keller', description: null, artist: 'Fernlicht', coverUrl: null, createdAt: ago(60 * DAY), updatedAt: ago(12 * DAY) },
    { id: uuid(12), name: 'Podcast-Intro Funkloch', description: null, artist: null, coverUrl: null, createdAt: ago(20 * DAY), updatedAt: ago(9 * DAY) },
  ];
  const track = (n: number, projectId: string, name: string, status: TrackStatus, sortOrder: number, coverUrl: string | null = null): DemoTrack =>
    ({ id: uuid(n), projectId, name, description: null, coverUrl, status, section: null, sortOrder, createdAt: ago(30 * DAY), updatedAt: ago(2 * HOUR) });
  const tracks: DemoTrack[] = [
    track(20, uuid(10), 'Nachtbus', 'in_progress', 0, COVER),
    track(21, uuid(10), 'Kreise', 'sketch', 1),
    track(22, uuid(10), 'Halbmond', 'final', 2),
    track(23, uuid(11), 'Zugabe', 'in_progress', 0),
    track(24, uuid(12), 'Jingle', 'final', 0),
  ];

  const version = (n: number, versionNumber: number, label: string | null, status: string, minutesAgo: number, notes: string, file: string, lufs: number, branch?: { of: number; label: string }): DemoVersion => ({
    id: uuid(n),
    trackId: uuid(20),
    versionNumber,
    label,
    notes,
    status,
    originalFileName: file,
    mimeType: 'audio/wav',
    fileSize: 54_700_000,
    duration: DEMO.duration,
    createdAt: ago(minutesAgo),
    createdById: KAI.id,
    parentVersionId: branch ? uuid(branch.of) : null,
    branchLabel: branch?.label ?? null,
    audio: `/demo/nachtbus-v${versionNumber}.mp3`,
    // Measured from the files in static/demo with ffmpeg's ebur128 filter
    integratedLufs: lufs,
  });
  const versions: DemoVersion[] = [
    version(104, 4, 'Mix 2 – mehr Bass', 'ready', 2 * HOUR, 'Bass +2 dB, Snare-Hall kürzer, Backings im Refrain breiter', 'Nachtbus_Mix2.wav', -15.3),
    version(103, 3, null, 'ready', 26 * HOUR, 'Wie V2, nur ohne Shaker', 'Nachtbus_Mix1_ohne_Shaker.wav', -15.9, { of: 102, label: 'Ohne Shaker' }),
    version(102, 2, 'Mix 1', 'rejected', 3 * DAY, 'Erster Mix von Lisa', 'Nachtbus_Mix1.wav', -15.9),
    version(101, 1, 'Rough Mix', 'ready', 7 * DAY, 'Bounce aus dem Proberaum', 'Nachtbus_rough.wav', -15.5),
  ];

  const comment = (n: number, versionN: number, by: Person | string, body: string, t: number | null, minutesAgo: number, extra: { resolved?: number; parent?: number } = {}): DemoComment => ({
    id: uuid(n),
    versionId: uuid(versionN),
    body,
    timestampSeconds: t,
    parentId: extra.parent ? uuid(extra.parent) : null,
    resolvedAt: extra.resolved !== undefined ? ago(extra.resolved) : null,
    createdAt: ago(minutesAgo),
    guestName: typeof by === 'string' ? by : null,
    user: typeof by === 'string' ? null : by,
  });
  const comments: DemoComment[] = [
    comment(401, 104, MARA, 'Insgesamt top. Die Höhen sind mir noch etwas scharf.', null, 10),
    comment(402, 104, LISA, 'Snare in der Strophe etwas zu laut', 42, 60),
    comment(403, 104, JONAS, 'Bass sitzt jetzt richtig gut 👍', 65, 58, { resolved: 30 }),
    comment(404, 104, JONAS, 'Backings im Refrain noch etwas lauter?', 72, 40),
    comment(405, 104, KAI, 'Mach ich in Mix 3.', null, 20, { parent: 404 }),
    comment(406, 104, 'Tom (Label)', 'Refrain ist stark. Fürs Radio bitte noch eine Version mit kürzerem Intro.', 112, 25),
    comment(407, 104, LISA, 'Solo-Gitarre könnte breiter sein', 126, 30),
    comment(301, 103, MARA, 'Ohne Shaker atmet der Refrain viel mehr.', 64, 25 * HOUR),
    comment(302, 103, JONAS, 'Hier fehlt er mir aber ein bisschen.', 82, 24 * HOUR, { resolved: 20 * HOUR }),
    comment(201, 102, MARA, `${REJECTION_PREFIX}Bass zu dünn, Hangtom klingt hohl`, null, 3 * DAY - 60),
    comment(202, 102, JONAS, 'Hangtom klingt hohl', 33, 3 * DAY - 180),
    comment(203, 102, LISA, 'Vocals im Refrain sitzen gut', 63, 3 * DAY - 150, { resolved: 3 * DAY - 100 }),
    comment(204, 102, LISA, 'Outro zu lang, nach zwei Runden ausblenden', 144, 3 * DAY - 120),
    comment(101, 101, JONAS, 'Tempo passt, Groove auch.', 22, 7 * DAY - 60, { resolved: 6 * DAY }),
    comment(102, 101, MARA, 'Zweite Strophe noch mal neu singen', 94, 7 * DAY - 30, { resolved: 4 * DAY }),
  ];

  const stem = (n: number, name: string, mb: number): DemoStem => ({
    id: uuid(n),
    trackId: uuid(20),
    name: `Nachtbus ${name}`,
    originalFileName: `Nachtbus_${name.replace(/ /g, '_')}.wav`,
    mimeType: 'audio/wav',
    fileSize: Math.round(mb * 1024 * 1024),
    createdAt: ago(5 * DAY),
    createdById: KAI.id,
  });
  const stems: DemoStem[] = [
    stem(501, 'Kick In', 41.2), stem(502, 'Kick Out', 41.2), stem(503, 'Snare Top', 40.9), stem(504, 'Snare Bottom', 40.9),
    stem(505, 'Hangtom', 40.9), stem(506, 'Overheads', 81.7), stem(507, 'Room', 81.7), stem(508, 'Bass DI', 40.9),
    stem(509, 'Gitarre L', 40.9), stem(510, 'Gitarre R', 40.9), stem(511, 'Lead Vocal', 52.4), stem(512, 'Backings', 48.1),
  ];

  return { projects, tracks, versions, comments, stems };
}

const db = seed();
let nextId = 900;

// "Erledigt" and the last visit of "Tracks"; like every change in the demo they stay in this window
const overviewState = { dismissed: new Set<string>(), tracksSeenAt: null as string | null };

// Roles in the demo projects: Jonas owns them, Kai mixes, Mara and Lisa are the band
const MEMBERS = [
  { userId: JONAS.id, role: 'owner' },
  { userId: MARA.id, role: 'artist' },
  { userId: LISA.id, role: 'artist' },
  { userId: KAI.id, role: 'mixing_engineer' },
];

function overview() {
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  return {
    projects: db.projects.map((p) => ({ id: p.id, name: p.name, artist: p.artist, coverUrl: p.coverUrl, myRole: 'artist', members: MEMBERS })),
    users: [MARA, KAI, LISA, JONAS],
    tracks: db.tracks.map((t) => ({ id: t.id, projectId: t.projectId, name: t.name, status: t.status, coverUrl: t.coverUrl, createdAt: t.createdAt, createdById: JONAS.id })),
    versions: db.versions.map((v) => ({
      id: v.id,
      trackId: v.trackId,
      versionNumber: v.versionNumber,
      label: v.label,
      branchLabel: v.branchLabel,
      parentVersionId: v.parentVersionId,
      status: v.status,
      createdById: v.createdById,
      createdAt: v.createdAt,
      duration: v.duration,
      integratedLufs: v.integratedLufs,
      decidedById: null,
      decidedAt: null,
      rejectionReason: withCounts(v).rejectionReason,
      hasActiveShareLink: v.id === uuid(104),
    })),
    comments: db.comments
      .filter((c) => c.parentId || !c.body.startsWith(REJECTION_PREFIX))
      .map((c) => ({
        id: c.id,
        versionId: c.versionId,
        parentId: c.parentId,
        userId: c.user?.id ?? null,
        guestName: c.guestName ?? null,
        timestampSeconds: c.timestampSeconds,
        resolvedAt: c.resolvedAt,
        createdAt: c.createdAt,
        body: c.body.slice(0, 200),
      })),
    // The two named listeners of the share link analytics below
    listens: [
      { versionId: uuid(104), listenerName: 'Tom (Label)', plays: 1, fullPlays: 1, maxSeconds: DEMO.duration, lastAt: ago(32) },
      { versionId: uuid(104), listenerName: 'Jonas', plays: 1, fullPlays: 0, maxSeconds: 130, lastAt: ago(70) },
    ],
    storage: { usedBytes: 0, versionBytes: 0, stemBytes: 0, limitBytes: 20 * 1024 ** 3, topTracks: [] },
    dismissedTaskKeys: [...overviewState.dismissed],
    tracksSeenAt: overviewState.tracksSeenAt,
  };
}

// Stand-in for the about 800 peaks the API computes from a recording; the same on every call
function demoPeaks(id: string): number[] {
  let seed = [...id].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261);
  const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const peaks: number[] = [];
  let level = 0.4;
  for (let i = 0; i < 800; i++) {
    const section = 0.55 + 0.3 * Math.sin((i / 800) * Math.PI * 4);
    level = level * 0.4 + section * (0.5 + random() * 0.6) * 0.6;
    peaks.push(Math.round(Math.min(1, level) * 1000) / 1000);
  }
  return peaks;
}

class NotFound extends Error {
  constructor() {
    super('Nicht gefunden');
  }
}
const find = <T extends { id: string }>(list: T[], id: string): T => {
  const item = list.find((x) => x.id === id);
  if (!item) throw new NotFound();
  return item;
};

function withCounts(v: DemoVersion): Version & DemoVersion {
  const topLevel = db.comments
    .filter((c) => c.versionId === v.id && !c.parentId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const rejection = topLevel.find((c) => c.body.startsWith(REJECTION_PREFIX));
  return {
    ...v,
    openCommentCount: topLevel.filter((c) => !c.resolvedAt).length,
    rejectionReason: v.status === 'rejected' && rejection ? rejection.body.slice(REJECTION_PREFIX.length) : null,
  };
}

function trackRow(t: DemoTrack) {
  const own = db.versions.filter((v) => v.trackId === t.id);
  return {
    ...t,
    coverImageUrl: t.coverUrl,
    versionCount: own.length,
    branchCount: new Set(own.map((v) => v.branchLabel).filter(Boolean)).size,
  };
}

function addComment(versionId: string, input: { body: string; timestampSeconds?: number; parentId?: string }) {
  find(db.versions, versionId);
  const c: DemoComment = {
    id: uuid(nextId++),
    versionId,
    body: input.body,
    timestampSeconds: input.timestampSeconds ?? null,
    parentId: input.parentId ?? null,
    resolvedAt: null,
    createdAt: new Date().toISOString(),
    guestName: null,
    user: MARA,
  };
  db.comments.push(c);
  return c;
}

function activity() {
  const versionById = new Map(db.versions.map((v) => [v.id, v]));
  const nachtbus = find(db.tracks, DEMO.trackId);
  const project = find(db.projects, nachtbus.projectId);
  const base = { project: { id: project.id, name: project.name }, track: { id: nachtbus.id, name: nachtbus.name } };
  const versionRef = (v: DemoVersion) => ({ id: v.id, versionNumber: v.versionNumber, label: v.label });
  const events = [
    ...db.comments.map((c) => ({
      type: 'comment' as const,
      id: c.id,
      createdAt: c.createdAt,
      user: c.user,
      guestName: c.guestName ?? null,
      ...base,
      version: versionRef(versionById.get(c.versionId)!),
      body: c.body,
      timestampSeconds: c.timestampSeconds,
    })),
    ...db.versions.map((v) => ({
      type: 'version' as const,
      id: v.id,
      createdAt: v.createdAt,
      user: KAI,
      guestName: null,
      ...base,
      version: versionRef(v),
      status: v.status,
    })),
  ];
  return events.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

type Body = Record<string, unknown> | undefined;
type Handler = (params: string[], body: Body) => unknown;

const ROUTES: [string, RegExp, Handler][] = [
  ['GET', /^\/auth\/me$/, () => ({ user: { id: MARA.id, email: 'mara@example.org', name: MARA.name, avatarUrl: null } })],
  ['GET', /^\/projects$/, () => ({
    projects: db.projects.map((project) => ({
      project: { ...project, coverImageUrl: project.coverUrl, createdById: KAI.id, isArchived: false },
      role: 'artist',
      trackCount: db.tracks.filter((t) => t.projectId === project.id).length,
    })),
  })],
  ['GET', /^\/projects\/([\w-]+)$/, ([id]) => {
    const project = find(db.projects, id);
    return { project: { ...project, coverImageUrl: project.coverUrl }, role: 'artist' };
  }],
  ['GET', /^\/tracks\/project\/([\w-]+)$/, ([id]) => ({
    tracks: db.tracks.filter((t) => t.projectId === id).sort((a, b) => a.sortOrder - b.sortOrder).map(trackRow),
  })],
  ['PATCH', /^\/tracks\/([\w-]+)$/, ([id], body) => {
    const t = find(db.tracks, id);
    if (typeof body?.name === 'string') t.name = body.name;
    if (typeof body?.status === 'string') t.status = body.status as TrackStatus;
    return { track: trackRow(t) };
  }],
  ['GET', /^\/versions\/track\/([\w-]+)$/, ([id]) => ({
    versions: db.versions.filter((v) => v.trackId === id).sort((a, b) => b.versionNumber - a.versionNumber).map(withCounts),
  })],
  ['GET', /^\/versions\/([\w-]+)\/(?:stream|download)-url$/, ([id]) => ({ url: find(db.versions, id).audio })],
  ['GET', /^\/versions\/([\w-]+)\/waveform-data$/, ([id]) => demoPeaks(find(db.versions, id).id)],
  ['POST', /^\/versions\/([\w-]+)\/approve$/, ([id]) => {
    const v = find(db.versions, id);
    v.status = 'approved';
    return { version: withCounts(v) };
  }],
  ['POST', /^\/versions\/([\w-]+)\/reject$/, ([id], body) => {
    const v = find(db.versions, id);
    v.status = 'rejected';
    addComment(id, { body: `${REJECTION_PREFIX}${String(body?.reason ?? '')}` });
    return { version: withCounts(v) };
  }],
  ['POST', /^\/versions\/([\w-]+)\/promote$/, ([id]) => {
    const v = find(db.versions, id);
    v.branchLabel = null;
    return { version: withCounts(v) };
  }],
  ['PATCH', /^\/versions\/([\w-]+)$/, ([id], body) => {
    const v = find(db.versions, id);
    if (body && 'label' in body) v.label = (body.label as string | null) ?? null;
    if (body && 'notes' in body) v.notes = (body.notes as string | null) ?? null;
    return { version: withCounts(v) };
  }],
  ['GET', /^\/comments\/version\/([\w-]+)$/, ([id]) => ({
    comments: db.comments.filter((c) => c.versionId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  })],
  ['POST', /^\/comments\/version\/([\w-]+)$/, ([id], body) => ({
    comment: addComment(id, body as { body: string; timestampSeconds?: number; parentId?: string }),
  })],
  ['POST', /^\/comments\/([\w-]+)\/resolve$/, ([id]) => {
    const c = find(db.comments, id);
    c.resolvedAt = new Date().toISOString();
    return { comment: c };
  }],
  ['POST', /^\/comments\/([\w-]+)\/reopen$/, ([id]) => {
    const c = find(db.comments, id);
    c.resolvedAt = null;
    return { comment: c };
  }],
  ['PATCH', /^\/comments\/([\w-]+)$/, ([id], body) => {
    const c = find(db.comments, id);
    c.body = String(body?.body ?? c.body);
    return { comment: c };
  }],
  ['DELETE', /^\/comments\/([\w-]+)$/, ([id]) => {
    find(db.comments, id);
    db.comments = db.comments.filter((c) => c.id !== id && c.parentId !== id);
    return { success: true };
  }],
  ['GET', /^\/stems\/track\/([\w-]+)$/, ([id]) => ({ stems: db.stems.filter((s) => s.trackId === id) })],
  ['GET', /^\/activity$/, () => ({ events: activity() })],
  ['GET', /^\/share\/version\/([\w-]+)$/, () => ({
    links: [{ id: uuid(601), token: '7f3a9c41e2d0b8a64c1f', expiresAt: null, allowComments: true, allowDownload: false, hasPassword: false, createdAt: new Date(Date.now() - 50 * 60_000).toISOString() }],
  })],
  ['GET', /^\/share\/version\/([\w-]+)\/analytics$/, () => {
    const at = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
    return {
      totalOpens: 6,
      totalPlays: 5,
      uniqueListeners: 4,
      avgListenSeconds: 118,
      completionRate: 60,
      events: [
        { id: uuid(701), listenerName: 'Tom (Label)', openedAt: at(32), firstPlayAt: at(31), listenSeconds: 155, completed: true },
        { id: uuid(702), listenerName: 'Jonas', openedAt: at(70), firstPlayAt: at(69), listenSeconds: 130, completed: false },
        { id: uuid(703), listenerName: null, openedAt: at(95), firstPlayAt: null, listenSeconds: 0, completed: false },
      ],
    };
  }],
  ['GET', /^\/overview$/, () => overview()],
  ['POST', /^\/overview\/dismissals$/, (_, body) => {
    overviewState.dismissed.add(String(body?.taskKey));
    return { ok: true };
  }],
  ['DELETE', /^\/overview\/dismissals$/, (_, body) => {
    overviewState.dismissed.delete(String(body?.taskKey));
    return { ok: true };
  }],
  ['POST', /^\/overview\/seen$/, () => ({ tracksSeenAt: (overviewState.tracksSeenAt = new Date().toISOString()) })],
];

/** Answers a request like the API under /api/v1 would, from the sample data. */
export async function demoRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, 80));
  const pathname = path.split('?')[0];
  for (const [m, pattern, handler] of ROUTES) {
    const match = m === method ? pattern.exec(pathname) : null;
    if (match) return structuredClone(handler(match.slice(1), body as Body)) as T;
  }
  console.warn(`[Demo] ${method} ${pathname} fehlt in den Demo-Daten`);
  throw new Error('In der Demo nicht verfügbar');
}
