// Pure helpers for the overview pages: Übersicht, Für dich, Tracks, Timeline and Mischpult.
// No $lib imports, so they can be checked with Bun like track.ts.
import { formatDate, formatTime } from './format.js';

export type TrackStatus = 'sketch' | 'in_progress' | 'final' | 'released';

export type OverviewProject = {
  id: string;
  name: string;
  artist: string | null;
  coverUrl: string | null;
  myRole: string;
  members: { userId: string; role: string }[];
};
export type OverviewUser = { id: string; name: string; avatarUrl: string | null };
export type OverviewTrack = {
  id: string;
  projectId: string;
  name: string;
  status: TrackStatus;
  coverUrl: string | null;
  createdAt: string;
  createdById: string;
};
export type OverviewVersion = {
  id: string;
  trackId: string;
  versionNumber: number;
  label: string | null;
  branchLabel: string | null;
  parentVersionId: string | null;
  status: string;
  createdById: string;
  createdAt: string;
  duration: number | null;
  integratedLufs: number | null;
  decidedById: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
  hasActiveShareLink: boolean;
};
export type OverviewComment = {
  id: string;
  versionId: string;
  parentId: string | null;
  userId: string | null;
  guestName: string | null;
  timestampSeconds: number | null;
  resolvedAt: string | null;
  createdAt: string;
  body: string;
};
export type OverviewListen = {
  versionId: string;
  listenerName: string | null;
  plays: number;
  fullPlays: number;
  maxSeconds: number;
  lastAt: string;
};
export type OverviewStorage = {
  usedBytes: number;
  versionBytes: number;
  stemBytes: number;
  limitBytes: number;
  topTracks: { trackId: string; name: string; bytes: number }[];
};
export type OverviewData = {
  projects: OverviewProject[];
  users: OverviewUser[];
  tracks: OverviewTrack[];
  versions: OverviewVersion[];
  comments: OverviewComment[];
  listens: OverviewListen[];
  storage: OverviewStorage;
  dismissedTaskKeys: string[];
  tracksSeenAt: string | null;
};

/** Roles whose feedback a version waits for */
export const FEEDBACK_ROLES = ['owner', 'artist', 'label', 'management'];
/** Roles that may upload versions */
export const UPLOAD_ROLES = ['owner', 'recording_engineer', 'mixing_engineer', 'mastering_engineer'];

const REJECTION_PREFIX = '❌ Abgelehnt: ';
const DAY = 86_400_000;
const ms = (iso: string) => new Date(iso).getTime();

/** Comments the reject route writes; the overview carries their text as rejectionReason. */
export const isRejection = (body: string) => body.startsWith(REJECTION_PREFIX);

export const trackHref = (projectId: string, trackId: string, versionId?: string | null) =>
  `/projects/${projectId}/tracks/${trackId}${versionId ? `?v=${versionId}` : ''}`;

// ---------- Lookups ----------

export type OverviewIndex = {
  data: OverviewData;
  me: string;
  users: Map<string, OverviewUser>;
  projects: Map<string, OverviewProject>;
  tracks: Map<string, OverviewTrack>;
  versions: Map<string, OverviewVersion>;
  /** Versions per track, V1 first */
  versionsOf: Map<string, OverviewVersion[]>;
  /** Comments and replies per version, oldest first */
  commentsOf: Map<string, OverviewComment[]>;
};

export function indexOverview(data: OverviewData, me: string): OverviewIndex {
  const versionsOf = new Map<string, OverviewVersion[]>();
  for (const t of data.tracks) versionsOf.set(t.id, []);
  for (const v of data.versions) versionsOf.get(v.trackId)?.push(v);
  for (const list of versionsOf.values()) list.sort((a, b) => a.versionNumber - b.versionNumber);
  const commentsOf = new Map<string, OverviewComment[]>();
  for (const c of [...data.comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const list = commentsOf.get(c.versionId);
    if (list) list.push(c);
    else commentsOf.set(c.versionId, [c]);
  }
  return {
    data,
    me,
    users: new Map(data.users.map((u) => [u.id, u])),
    projects: new Map(data.projects.map((p) => [p.id, p])),
    tracks: new Map(data.tracks.map((t) => [t.id, t])),
    versions: new Map(data.versions.map((v) => [v.id, v])),
    versionsOf,
    commentsOf,
  };
}

// ---------- Names ----------

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

export const initials = (name: string) =>
  name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

/** "Du" for yourself, first names for members, "Name (Gast)" for guests */
export function personName(ix: OverviewIndex, userId: string | null, guestName: string | null = null): string {
  if (userId === ix.me) return 'Du';
  if (userId) return firstName(ix.users.get(userId)?.name ?? 'Jemand');
  return guestName ? `${guestName} (Gast)` : 'Gast';
}

/** Full name for avatars and tooltips */
export function fullName(ix: OverviewIndex, userId: string | null, guestName: string | null = null): string {
  if (userId) return ix.users.get(userId)?.name ?? 'Jemand';
  return guestName || 'Gast';
}

export const avatarOf = (ix: OverviewIndex, userId: string | null) =>
  userId ? (ix.users.get(userId)?.avatarUrl ?? null) : null;

/** "A", "A und B", "A, B und C" */
export function joinNames(names: string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`;
}

/** Guests reached by a share link; '' stands for guests without a name */
export const guestLabel = (name: string) => (name ? `${name} (per Link)` : 'Gäste per Link');

export const versionName = (v: { label: string | null; branchLabel: string | null }) => v.label || v.branchLabel || '';

// ---------- Events ----------

export type EventKind = 'created' | 'version' | 'approved' | 'rejected' | 'comment' | 'reply';
export type OverviewEvent = {
  kind: EventKind;
  at: string;
  actorId: string | null;
  guestName: string | null;
  track: OverviewTrack;
  version: OverviewVersion | null;
  comment: OverviewComment | null;
  /** The comment a reply answers */
  parent: OverviewComment | null;
};

/** Everything that happened on the given tracks, newest first */
export function eventsOf(ix: OverviewIndex, tracks: OverviewTrack[] = ix.data.tracks): OverviewEvent[] {
  const out: OverviewEvent[] = [];
  const none = { guestName: null, version: null, comment: null, parent: null };
  for (const track of tracks) {
    out.push({ ...none, kind: 'created', at: track.createdAt, actorId: track.createdById, track });
    for (const version of ix.versionsOf.get(track.id) ?? []) {
      out.push({ ...none, kind: 'version', at: version.createdAt, actorId: version.createdById, track, version });
      // Decisions from before decidedAt existed have no time and stay out
      if (version.decidedAt && (version.status === 'approved' || version.status === 'rejected')) {
        const kind = version.status === 'approved' ? 'approved' : 'rejected';
        out.push({ ...none, kind, at: version.decidedAt, actorId: version.decidedById, track, version });
      }
      const comments = ix.commentsOf.get(version.id) ?? [];
      for (const comment of comments) {
        out.push({
          kind: comment.parentId ? 'reply' : 'comment',
          at: comment.createdAt,
          actorId: comment.userId,
          guestName: comment.guestName,
          track,
          version,
          comment,
          parent: comment.parentId ? (comments.find((c) => c.id === comment.parentId) ?? null) : null,
        });
      }
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** What someone did last, as the column "Zuletzt" on "Tracks" says it */
export function lastText(e: OverviewEvent, me: string): string {
  const mine = e.actorId === me;
  const v = e.version ? `V${e.version.versionNumber}` : '';
  switch (e.kind) {
    case 'version':
      return mine ? `hast ${v} hochgeladen` : `lud ${v} hoch`;
    case 'comment':
      return mine ? 'hast kommentiert' : 'kommentierte';
    case 'reply':
      return mine ? 'hast geantwortet' : 'antwortete';
    case 'approved':
      return mine ? `hast ${v} freigegeben` : `gab ${v} frei`;
    case 'rejected':
      return mine ? `hast ${v} abgelehnt` : `lehnte ${v} ab`;
    case 'created':
      return mine ? 'hast den Track angelegt' : 'legte den Track an';
  }
}

// ---------- Stage, turn, new ----------

export type StageKey = 'none' | 'processing' | 'approved' | 'rejected' | 'open' | 'feedback';
export type Stage = { key: StageKey; text: string };

/** Icon of Icon.svelte per stage; colours only ever appear together with icon and text */
export const STAGE_ICON = {
  none: 'music',
  processing: 'upload',
  approved: 'check',
  rejected: 'x',
  open: 'comment',
  feedback: 'clock',
} as const;

export type TrackInfo = {
  track: OverviewTrack;
  project: OverviewProject;
  /** V1 first */
  versions: OverviewVersion[];
  latest: OverviewVersion | null;
  /** Open top-level comments of the latest version */
  open: OverviewComment[];
  stage: Stage;
  /** Users whose turn it is */
  turn: string[];
  /** Guests reached by an active share link; '' for guests without a name */
  guests: string[];
  /** Final, released or latest version approved */
  done: boolean;
  /** It is your turn on a running track */
  mine: boolean;
  /** Someone else did something since your last visit of "Tracks" */
  isNew: boolean;
  /** Latest event, at least the creation of the track */
  last: OverviewEvent;
};

export function trackInfo(ix: OverviewIndex, track: OverviewTrack): TrackInfo {
  const project = ix.projects.get(track.projectId)!;
  const versions = ix.versionsOf.get(track.id) ?? [];
  const latest = versions[versions.length - 1] ?? null;
  const comments = latest ? (ix.commentsOf.get(latest.id) ?? []) : [];
  const open = comments.filter((c) => !c.parentId && !c.resolvedAt);
  let stage: Stage;
  let turn: string[] = [];
  let guests: string[] = [];
  if (!latest) {
    stage = { key: 'none', text: 'Noch keine Version' };
    turn = project.members.filter((m) => m.role === 'owner').map((m) => m.userId);
  } else if (latest.status === 'uploaded' || latest.status === 'processing') {
    stage = { key: 'processing', text: 'Wird verarbeitet' };
  } else if (latest.status === 'approved') {
    stage = { key: 'approved', text: 'Freigegeben' };
  } else if (latest.status === 'rejected') {
    stage = { key: 'rejected', text: 'Abgelehnt' };
    turn = [latest.createdById];
  } else if (open.length) {
    stage = { key: 'open', text: open.length === 1 ? '1 offener Kommentar' : `${open.length} offene Kommentare` };
    turn = [latest.createdById];
  } else {
    stage = { key: 'feedback', text: 'Wartet auf Feedback' };
    turn = project.members
      .filter((m) => FEEDBACK_ROLES.includes(m.role) && m.userId !== latest.createdById)
      .map((m) => m.userId);
    if (latest.hasActiveShareLink) {
      const names = new Set<string>();
      for (const l of ix.data.listens) if (l.versionId === latest.id && l.listenerName) names.add(l.listenerName);
      for (const c of comments) if (c.guestName) names.add(c.guestName);
      guests = names.size ? [...names] : [''];
    }
  }
  const done = track.status === 'final' || track.status === 'released' || latest?.status === 'approved';
  const events = eventsOf(ix, [track]);
  const seen = ix.data.tracksSeenAt;
  return {
    track,
    project,
    versions,
    latest,
    open,
    stage,
    turn,
    guests,
    done,
    mine: !done && turn.includes(ix.me),
    // Without a first visit nothing counts as new
    isNew: seen !== null && events.some((e) => e.actorId !== ix.me && e.at > seen),
    last: events[0],
  };
}

export type ProjectGroup = {
  project: OverviewProject;
  /** Running tracks first, then finished ones, each by last activity */
  list: TrackInfo[];
  active: TrackInfo[];
  done: TrackInfo[];
  lastAt: string;
};

/** Projects with their tracks, the most recently active first */
export function projectGroups(ix: OverviewIndex): ProjectGroup[] {
  const infos = ix.data.tracks.map((t) => trackInfo(ix, t));
  const byLast = (a: TrackInfo, b: TrackInfo) => b.last.at.localeCompare(a.last.at);
  return ix.data.projects
    .map((project) => {
      const own = infos.filter((i) => i.project.id === project.id);
      const active = own.filter((i) => !i.done).sort(byLast);
      const done = own.filter((i) => i.done).sort(byLast);
      const lastAt = own.reduce((max, i) => (i.last.at > max ? i.last.at : max), '');
      return { project, list: [...active, ...done], active, done, lastAt };
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt) || a.project.name.localeCompare(b.project.name));
}

/** "Du bist dran", "Lena ist dran", "Du, Lena und Tom seid dran"; empty when nobody is */
export function turnText(ix: OverviewIndex, info: TrackInfo): string {
  if (info.done) return '';
  const others = info.turn
    .filter((id) => id !== ix.me)
    .map((id) => firstName(ix.users.get(id)?.name ?? 'Jemand'))
    .concat(info.guests.map(guestLabel));
  if (info.mine) return others.length ? `Du, ${joinNames(others)} seid dran` : 'Du bist dran';
  if (!others.length) return '';
  return others.length === 1 ? `${others[0]} ist dran` : `${joinNames(others)} sind dran`;
}

export type TurnRow = { key: string; label: string; avatarName: string; avatarUrl: string | null; infos: TrackInfo[] };

/** "Wer ist dran": per person the running tracks waiting for them; you first, then by count */
export function turnRows(ix: OverviewIndex, infos: TrackInfo[]): TurnRow[] {
  const rows = new Map<string, TurnRow>();
  const add = (key: string, label: string, avatarName: string, avatarUrl: string | null, info: TrackInfo) => {
    let row = rows.get(key);
    if (!row) rows.set(key, (row = { key, label, avatarName, avatarUrl, infos: [] }));
    row.infos.push(info);
  };
  for (const info of infos) {
    if (info.done) continue;
    for (const id of info.turn) {
      const user = ix.users.get(id);
      add(id, id === ix.me ? 'Du' : firstName(user?.name ?? 'Jemand'), user?.name ?? 'Jemand', user?.avatarUrl ?? null, info);
    }
    for (const guest of info.guests) add(`guest:${guest}`, guestLabel(guest), guest || 'Gäste', null, info);
  }
  return [...rows.values()].sort(
    (a, b) => Number(b.key === ix.me) - Number(a.key === ix.me) || b.infos.length - a.infos.length,
  );
}

// ---------- Für dich ----------

type TaskBase = { key: string; at: string; info: TrackInfo; version: OverviewVersion };
export type Task =
  | (TaskBase & { kind: 'listen' })
  | (TaskBase & { kind: 'open'; comments: OverviewComment[]; rejected: boolean })
  | (TaskBase & { kind: 'reply'; comment: OverviewComment; reply: OverviewComment });

/**
 * What waits for you, newest first. Every task has a key; "Erledigt" stores it. New activity
 * produces a new key (another newest open comment, another reply), so the task comes back.
 */
export function tasksFor(ix: OverviewIndex): Task[] {
  const out: Task[] = [];
  for (const track of ix.data.tracks) {
    const info = trackInfo(ix, track);
    const v = info.latest;
    if (!v) continue;
    const comments = ix.commentsOf.get(v.id) ?? [];
    if (v.createdById !== ix.me) {
      const heard = comments.some((c) => c.userId === ix.me);
      if (v.status === 'ready' && FEEDBACK_ROLES.includes(info.project.myRole) && !heard) {
        out.push({ kind: 'listen', key: `listen:${v.id}`, at: v.createdAt, info, version: v });
      }
    } else if (v.status === 'rejected') {
      out.push({ kind: 'open', key: `rejected:${v.id}`, at: v.decidedAt ?? v.createdAt, info, version: v, comments: info.open, rejected: true });
    } else if (info.open.length) {
      const newest = info.open.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
      out.push({ kind: 'open', key: `open:${v.id}:${newest.id}`, at: newest.createdAt, info, version: v, comments: info.open, rejected: false });
    }
    for (const reply of comments) {
      if (!reply.parentId || reply.userId === ix.me) continue;
      const comment = comments.find((c) => c.id === reply.parentId);
      if (comment?.userId === ix.me) {
        out.push({ kind: 'reply', key: `reply:${reply.id}`, at: reply.createdAt, info, version: v, comment, reply });
      }
    }
  }
  const dismissed = new Set(ix.data.dismissedTaskKeys);
  return out.filter((t) => !dismissed.has(t.key)).sort((a, b) => b.at.localeCompare(a.at));
}

// ---------- Übersicht ----------

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / DAY + 1) / 7);
}

export type WeekBucket = { start: Date; end: Date; week: number; versions: number; comments: number; current: boolean };

/** Versions and comments (with replies) per calendar week, oldest week first */
export function weekBuckets(events: { kind: EventKind; at: string }[], weeks: number, now = new Date()): WeekBucket[] {
  const first = startOfWeek(now);
  const buckets: WeekBucket[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(first);
    start.setDate(start.getDate() - 7 * i);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    buckets.push({ start, end, week: isoWeek(start), versions: 0, comments: 0, current: i === 0 });
  }
  for (const e of events) {
    const t = ms(e.at);
    const bucket = buckets.find((b) => t >= b.start.getTime() && t < b.end.getTime());
    if (!bucket) continue;
    if (e.kind === 'version') bucket.versions++;
    else if (e.kind === 'comment' || e.kind === 'reply') bucket.comments++;
  }
  return buckets;
}

/** The numbers of the head line: the last seven days */
export function weekSummary(events: { kind: EventKind; at: string }[], now = Date.now()) {
  const recent = events.filter((e) => ms(e.at) >= now - 7 * DAY);
  return {
    versions: recent.filter((e) => e.kind === 'version').length,
    comments: recent.filter((e) => e.kind === 'comment' || e.kind === 'reply').length,
    approvals: recent.filter((e) => e.kind === 'approved').length,
  };
}

/** Latest versions with a measurement, grouped by project; versions without one stay out */
export function loudnessGroups(groups: ProjectGroup[]) {
  return groups
    .map((g) => ({ project: g.project, rows: g.list.filter((i) => i.latest?.integratedLufs != null) }))
    .filter((g) => g.rows.length);
}

// ---------- Timeline ----------

/** Range from the Monday `weeks` weeks back to a day and a half after now, with a tick per Monday */
export function timelineRange(weeks: number, now = Date.now()) {
  const start = startOfWeek(new Date(now - (weeks * 7 - 1) * DAY)).getTime();
  const end = now + 1.5 * DAY;
  const ticks: number[] = [];
  for (const t = new Date(start); t.getTime() < end; t.setDate(t.getDate() + 7)) ticks.push(t.getTime());
  return { start, end, ticks, pct: (t: number) => ((t - start) / (end - start)) * 100 };
}
export type TimelineRange = ReturnType<typeof timelineRange>;

// ---------- Mischpult ----------

/** Tracks with at least two versions, the most recently active first */
export function mixerTracks(groups: ProjectGroup[]): TrackInfo[] {
  return groups
    .flatMap((g) => g.list)
    .filter((i) => i.versions.length > 1)
    .sort((a, b) => b.last.at.localeCompare(a.last.at));
}

/** Loudness match in dB: down to the quietest measured version, never up; 0 without a measurement */
export function matchGains(versions: { id: string; integratedLufs: number | null }[], match: boolean): Map<string, number> {
  const measured = versions.map((v) => v.integratedLufs).filter((x): x is number => x !== null);
  const ref = measured.length ? Math.min(...measured) : null;
  return new Map(
    versions.map((v) => [v.id, match && ref !== null && v.integratedLufs !== null ? ref - v.integratedLufs : 0]),
  );
}

/** Lit segments of an LED meter from −36 to 0 dBFS */
export function ledCount(amplitude: number, segments = 16): number {
  if (amplitude <= 0) return 0;
  const db = 20 * Math.log10(amplitude);
  return Math.round(Math.max(0, Math.min(1, (db + 36) / 36)) * segments);
}

/** The lamp of a channel strip */
export function versionLamp(v: { status: string }, isLatest: boolean, topLevel: { resolvedAt: string | null }[]): Stage {
  if (v.status === 'approved') return { key: 'approved', text: 'Frei' };
  if (v.status === 'rejected') return { key: 'rejected', text: 'Abgelehnt' };
  const open = topLevel.filter((c) => !c.resolvedAt).length;
  if (open) return { key: 'open', text: `${open} offen` };
  if (isLatest) return { key: 'feedback', text: 'Feedback' };
  return { key: 'none', text: topLevel.length ? 'erledigt' : 'ohne Feedback' };
}

/** "Freigegeben von Robin, Sa., 3. Okt." or "Abgelehnt von Robin: „…“"; old decisions have no person */
export function decisionText(ix: OverviewIndex, v: OverviewVersion): string {
  const who = v.decidedById ? ` von ${firstName(ix.users.get(v.decidedById)?.name ?? 'Jemand')}` : '';
  if (v.status === 'approved') return `Freigegeben${who}${v.decidedAt ? `, ${formatDate(v.decidedAt)}` : ''}`;
  if (v.status === 'rejected') return `Abgelehnt${who}${v.rejectionReason ? `: „${v.rejectionReason}“` : ''}`;
  return '';
}

// ---------- Waveforms ----------

/** About 800 peaks reduced to `count` bars, scaled to the loudest; flat without peaks */
export function downsample(peaks: number[], count: number): number[] {
  if (!peaks.length) return new Array<number>(count).fill(0);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const from = Math.floor((i * peaks.length) / count);
    const to = Math.max(from + 1, Math.floor(((i + 1) * peaks.length) / count));
    let max = 0;
    for (let j = from; j < to && j < peaks.length; j++) max = Math.max(max, peaks[j]);
    out.push(max);
  }
  const top = Math.max(...out);
  return top > 0 ? out.map((x) => x / top) : out;
}

export type Marker = { id: string; seconds: number; tip: string; done: boolean; initials?: string };

/** Comment markers on a waveform; replies have no position of their own */
export function markersFor(ix: OverviewIndex, comments: OverviewComment[], withInitials = false): Marker[] {
  return comments
    .filter((c) => !c.parentId && c.timestampSeconds !== null)
    .map((c) => {
      const seconds = c.timestampSeconds!;
      const body = c.body.length > 46 ? `${c.body.slice(0, 45)}…` : c.body;
      return {
        id: c.id,
        seconds,
        tip: `${personName(ix, c.userId, c.guestName)} bei ${formatTime(seconds)}: ${body}`,
        done: c.resolvedAt !== null,
        initials: withInitials ? initials(fullName(ix, c.userId, c.guestName)) : undefined,
      };
    });
}
