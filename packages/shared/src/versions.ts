type VersionRef = {
  id: string;
  versionNumber: number;
  parentVersionId?: string | null;
  branchLabel?: string | null;
};

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
