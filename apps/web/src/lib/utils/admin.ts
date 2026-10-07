import type { ComponentProps } from 'svelte';
import type { ProjectRole } from '@music-hub/shared';
import type Icon from '$lib/components/ui/Icon.svelte';

type IconName = ComponentProps<typeof Icon>['name'];

// ---------- Answers of /admin/* ----------

export type Counts = { versions: number; stems: number; comments: number; approvals: number; plays: number };

export type ActionType = 'login' | 'version' | 'stem' | 'comment' | 'approve' | 'reject' | 'share' | 'push' | 'task' | 'tracks';

export type Person = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  createdAt: string;
  invitedTo: { projectId: string; projectName: string; role: ProjectRole; at: string } | null;
  // Invited but never logged in
  pending: boolean;
  inviteExpiresAt: string | null;
  hasPassword: boolean;
  blocked: boolean;
  lastSeenAt: string | null;
  online: boolean;
  lastAction: { type: ActionType; at: string } | null;
  // The later of lastSeenAt and lastAction
  lastActiveAt: string | null;
  projectCount: number;
  storageBytes: number;
  storageLimitBytes: number;
  counts: Counts;
};

export type Totals = {
  versions: number;
  stems: number;
  comments: number;
  guestComments: number;
  opens: number;
  plays: number;
  complete: number;
};

export type SeriesPoint = { start: string; value: number };

/** One column of ColumnChart; `tip` is the tooltip, `tick` shows the label under the axis */
export type Column = { label: string; value: number; tip: string; tick: boolean };

export type AdminOverview = {
  days: number;
  people: Person[];
  current: Totals;
  previous: Totals;
  series: { unit: 'day' | 'week'; points: SeriesPoint[] };
  projects: {
    id: string;
    name: string;
    artist: string | null;
    archived: boolean;
    members: number;
    openInvites: number;
    uploads: number;
    comments: number;
    lastActivityAt: string | null;
  }[];
  shareLinks: {
    id: string;
    trackName: string;
    versionNumber: number;
    projectName: string;
    creatorName: string;
    opens: number;
    plays: number;
  }[];
  storageLimitBytes: number;
};

export type AdminEvent = {
  type: 'login' | 'version' | 'stems' | 'comment' | 'decision' | 'share' | 'listen' | 'invite' | 'push';
  at: string;
  userId: string | null;
  projectId?: string;
  projectName?: string;
  trackName?: string;
  versionNumber?: number;
  via?: string;
  count?: number;
  status?: string;
  until?: string | null;
  password?: boolean;
  guestName?: string | null;
  linkCreatorId?: string | null;
  played?: boolean;
  seconds?: number;
  duration?: number | null;
  completed?: boolean;
  device?: string;
  role?: ProjectRole;
};

export type PersonDetail = {
  person: Person & { countsAll: Counts };
  weekly: SeriesPoint[];
  activity: AdminEvent[];
  logins: AdminEvent[];
  projects: { id: string; name: string; artist: string | null; role: ProjectRole; since: string }[];
  devices: { kind: 'push' | 'plugin'; label: string; since: string }[];
};

export type Listener = { guestName: string | null; seconds: number; completed: boolean; played: boolean; at: string; device: string };

export type ShareLinkRow = {
  id: string;
  createdAt: string;
  expiresAt: string | null;
  hasPassword: boolean;
  allowDownload: boolean;
  trackName: string;
  versionNumber: number;
  duration: number | null;
  projectId: string;
  projectName: string;
  creatorId: string;
  creatorName: string;
  opens: number;
  plays: number;
  complete: number;
  guestComments: number;
  listeners: Listener[];
};

// ---------- Helpers ----------

const DAY = 86_400_000;

export const ACTION_LABEL: Record<ActionType, string> = {
  login: 'Login',
  version: 'Upload',
  stem: 'Stems',
  comment: 'Kommentar',
  approve: 'Freigabe',
  reject: 'Ablehnung',
  share: 'Share-Link',
  push: 'Push eingeschaltet',
  task: 'Aufgabe erledigt',
  tracks: 'Tracks angesehen',
};

export const VIA_LABEL: Record<string, string> = {
  password: 'mit Passwort',
  magic_link: 'per Magic Link',
  invite: 'über den Link aus der Einladung',
  registration: 'über die Registrierung',
  plugin: 'über das Plugin',
};

/** Active: something within seven days. Away: logged in once, but not for longer. Never: invited, never logged in. */
export type PersonState = 'active' | 'away' | 'never';

export function personState(p: Person, now = Date.now()): PersonState {
  if (p.pending) return 'never';
  return p.lastActiveAt && now - Date.parse(p.lastActiveAt) <= 7 * DAY ? 'active' : 'away';
}

/** The last action is shown with its own time only when it lies apart from the last activity */
export const apart = (a: string, b: string | null) => !b || Math.abs(Date.parse(a) - Date.parse(b)) > 5 * 60_000;

/** Whole days since `iso`, counted in calendar days */
export function daysSince(iso: string, now = Date.now()): number {
  const start = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  return Math.round((start(now) - start(Date.parse(iso))) / DAY);
}

/** State of the link an invite mailed out; null when there is none left */
export function inviteState(p: Person, now = Date.now()): { tone: 'warning' | 'default' | 'muted'; short: string; long: string } | null {
  if (!p.inviteExpiresAt) return null;
  const expires = new Date(p.inviteExpiresAt);
  const time = expires.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const date = expires.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
  if (expires.getTime() < now) {
    const day = expires.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
    return { tone: 'muted', short: 'Link abgelaufen', long: `Der Link aus der Einladung ist am ${day} abgelaufen.` };
  }
  if (daysSince(p.inviteExpiresAt, now) === 0) {
    return { tone: 'warning', short: `Link läuft heute ${time} ab`, long: `Der Link aus der Einladung läuft heute um ${time} ab.` };
  }
  return { tone: 'default', short: `Link gültig bis ${date}`, long: `Der Link aus der Einladung gilt bis ${date}, ${time}.` };
}

/** "Mo. 5.10." for a day, "KW 41" for a week of the charts */
export function pointLabel(start: string, unit: 'day' | 'week'): string {
  const [y, m, d] = start.split('-').map(Number);
  const date = new Date(y!, m! - 1, d!);
  if (unit === 'week') return `KW ${isoWeek(date)}`;
  return `${date.toLocaleDateString('de-DE', { weekday: 'short' })} ${date.getDate()}.${date.getMonth() + 1}.`;
}

function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / DAY + 1) / 7);
}

/** "Dienstag, 6. Oktober · Stand 14:12" */
export function standOf(ms: number): string {
  const d = new Date(ms);
  const day = d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  return `${day} · Stand ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
}

/** "3 Personen", "1 Person" */
export const plural = (n: number, one: string, many: string) => `${n.toLocaleString('de-DE')} ${n === 1 ? one : many}`;

export const EVENT_ICON: Record<AdminEvent['type'], IconName> = {
  login: 'log-in',
  version: 'upload',
  stems: 'layers',
  comment: 'comment',
  decision: 'check',
  share: 'link',
  listen: 'headphones',
  invite: 'mail',
  push: 'bell',
};

/** Icon of an event; rejections and links opened without playing get their own */
export function eventIcon(e: AdminEvent): IconName {
  if (e.type === 'decision' && e.status === 'rejected') return 'x';
  if (e.type === 'listen' && !e.played) return 'link';
  return EVENT_ICON[e.type];
}

/** Kinds the protocol filters by */
export const EVENT_KINDS = [
  { key: 'login', label: 'Logins', types: ['login'] },
  { key: 'upload', label: 'Uploads', types: ['version', 'stems'] },
  { key: 'comment', label: 'Kommentare', types: ['comment'] },
  { key: 'decision', label: 'Freigaben', types: ['decision'] },
  { key: 'share', label: 'Share-Links', types: ['share'] },
  { key: 'listen', label: 'Gäste hören', types: ['listen'] },
  { key: 'invite', label: 'Einladungen', types: ['invite'] },
  { key: 'push', label: 'Push', types: ['push'] },
] as const satisfies readonly { key: string; label: string; types: readonly AdminEvent['type'][] }[];

/** Guests heard something or wrote something */
export const isGuestEvent = (e: AdminEvent) => e.type === 'listen' || (e.type === 'comment' && !e.userId);
