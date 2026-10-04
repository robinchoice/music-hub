// Pure helpers for the track page. No $lib imports, so they can be checked with `bun -e`.

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
};

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
