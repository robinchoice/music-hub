// Pure helpers for the track page. No $lib imports, so they can be checked with `bun -e`.
import { REVIEW_PASS_HOURS, type ReviewVerdict } from '@music-hub/shared';

export type { ReviewVerdict } from '@music-hub/shared';

export type Version = {
  id: string;
  versionNumber: number;
  label: string | null;
  notes: string | null;
  status: string;
  originalFileName: string;
  duration: number | null;
  createdAt: string;
  parentVersionId: string | null;
  branchLabel: string | null;
  openCommentCount: number;
  rejectionReason: string | null;
  createdById?: string;
};

export type TrackComment = {
  id: string;
  body: string;
  timestampSeconds: number | null;
  parentId: string | null;
  resolvedAt: string | null;
  createdAt: string;
  guestName?: string | null;
  user: { id: string; name: string; avatarUrl: string | null } | null;
  /** Set on a deleted comment that stays as an empty placeholder because it has replies */
  deletedAt?: string | null;
  /** Its author may still restore that placeholder from the trash */
  restorable?: boolean;
  /** Grouped by emoji in picker order; missing from an older API */
  reactions?: Reaction[];
};

export type Reaction = { emoji: string; users: { id: string; name: string }[] };

type VersionRef = {
  id: string;
  versionNumber: number;
  parentVersionId?: string | null;
  branchLabel?: string | null;
};

type Timed = { id: string; timestampSeconds: number | null; createdAt: string };

/** The version whose open comments carry over: a variant's parent, otherwise the previous mainline version. */
export function predecessorOf<T extends VersionRef>(version: T, versions: T[]): T | null {
  // Promoting a variant clears its branchLabel but keeps parentVersionId; it counts as mainline then.
  if (version.parentVersionId && version.branchLabel) return versions.find((v) => v.id === version.parentVersionId) ?? null;
  let best: T | null = null;
  for (const v of versions) {
    if (v.branchLabel || v.versionNumber >= version.versionNumber) continue;
    if (!best || v.versionNumber > best.versionNumber) best = v;
  }
  return best;
}

// The worker writes a waveform once it has read the file; one it gave up on stays without duration
export function hasWaveform(v: { status: string; duration: number | null }): boolean {
  return v.status !== 'uploaded' && v.status !== 'processing' && v.duration != null;
}

/** Label for lists: version label, then branch label, then the file name without extension. */
export function versionTitle(v: { label: string | null; branchLabel?: string | null; originalFileName: string }): string {
  return v.label || v.branchLabel || v.originalFileName.replace(/\.[^.]+$/, '');
}

/** Drops a leading track name plus separator: "Heute Kind Sein Lead Vocal" → "Lead Vocal". */
export function spurDisplayName(name: string, trackName: string): string {
  const prefix = trackName.trim().toLowerCase();
  if (!prefix || !name.toLowerCase().startsWith(prefix)) return name;
  const rest = name.slice(prefix.length);
  if (!/^[\s_-]/.test(rest)) return name;
  return rest.replace(/^[\s_-]+/, '') || name;
}

export function compareSpurNames(a: string, b: string): number {
  return a.localeCompare(b, 'de', { numeric: true, sensitivity: 'base' });
}

/** General comments first, then by position in the song, then by age. */
export function byPosition(a: Timed, b: Timed): number {
  return (a.timestampSeconds ?? -1) - (b.timestampSeconds ?? -1) || a.createdAt.localeCompare(b.createdAt);
}

/** The comment with the latest timestamp at or before the playhead. */
export function activeCommentId(comments: Timed[], time: number): string | null {
  let active: Timed | null = null;
  for (const c of comments) {
    if (c.timestampSeconds === null || c.timestampSeconds > time) continue;
    if (!active || c.timestampSeconds >= (active.timestampSeconds ?? 0)) active = c;
  }
  return active?.id ?? null;
}

export type Person = { id: string; name: string; avatarUrl: string | null };

/** A finished listening pass; without a verdict it is the summary the server sent on its own. */
export type Review = {
  id: string;
  verdict: ReviewVerdict | null;
  note: string | null;
  commentCount: number;
  createdAt: string;
  guestName: string | null;
  user: Person | null;
};

type Authored = { createdAt: string; guestName?: string | null; user?: { id: string } | null };

const authorKey = (x: Authored) => (x.user ? x.user.id : x.guestName ? `guest:${x.guestName}` : null);

// Like the API (REVIEW_PASS_HOURS): only recent comments make up a pass, older threads stay out of it
const PASS_MS = REVIEW_PASS_HOURS * 3600_000;
const recent = (c: { createdAt: string }, now: number) => new Date(c.createdAt).getTime() > now - PASS_MS;

/** The author's recent comments since their last review on this version: what "Fertig" closes. */
export function openPass<T extends Authored & { deletedAt?: string | null }>(comments: T[], reviews: Authored[], key: string, now = Date.now()): T[] {
  const last = reviews.filter((r) => authorKey(r) === key).reduce((max, r) => (r.createdAt > max ? r.createdAt : max), '');
  return comments.filter((c) => !c.deletedAt && authorKey(c) === key && c.createdAt > last && recent(c, now));
}

export type FeedbackRow = { key: string; name: string; avatarUrl: string | null; review: Review | null; open: number };

/**
 * Who has finished listening to a version and how, who is still at it, and which approvers haven't
 * said anything yet. The uploader's own comments don't count.
 */
export function feedbackRows(comments: TrackComment[], reviews: Review[], waiting: Person[], uploaderId: string | null, now = Date.now()): FeedbackRow[] {
  const rows = new Map<string, FeedbackRow>();
  const person = (x: { user: Person | null; guestName?: string | null }) =>
    x.user ? { name: x.user.name, avatarUrl: x.user.avatarUrl } : { name: x.guestName ?? 'Gast', avatarUrl: null };

  // Newest first: the first review of each author is their current verdict
  for (const r of [...reviews].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const key = authorKey(r);
    if (!key || rows.has(key)) continue;
    rows.set(key, { key, ...person(r), review: r, open: 0 });
  }
  for (const c of comments) {
    const key = authorKey(c);
    if (!key || c.deletedAt || c.user?.id === uploaderId || !recent(c, now)) continue;
    const row = rows.get(key) ?? { key, ...person(c), review: null, open: 0 };
    if (c.createdAt > (row.review?.createdAt ?? '')) row.open++;
    rows.set(key, row);
  }
  for (const p of waiting) if (!rows.has(p.id)) rows.set(p.id, { key: p.id, name: p.name, avatarUrl: p.avatarUrl, review: null, open: 0 });
  // Still listening first, then finished, then waiting
  const rank = (r: FeedbackRow) => (r.open > 0 ? 0 : r.review ? 1 : 2);
  return [...rows.values()].sort((a, b) => rank(a) - rank(b));
}
