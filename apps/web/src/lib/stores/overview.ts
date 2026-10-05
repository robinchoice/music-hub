import { writable, derived } from 'svelte/store';
import { api } from '$lib/api/client.js';
import { user } from '$lib/stores/auth.js';
import { indexOverview, tasksFor, type OverviewData } from '$lib/utils/overview.js';

/** Answer of GET /overview; null until the first load */
export const overview = writable<OverviewData | null>(null);

/** Lookups for the signed-in user */
export const overviewIndex = derived([overview, user], ([$overview, $user]) =>
  $overview && $user ? indexOverview($overview, $user.id) : null,
);

/** Open tasks on "Für dich", newest first; the sidebar and the bottom bar show their count */
export const tasks = derived(overviewIndex, ($ix) => ($ix ? tasksFor($ix) : []));

let pending: Promise<void> | null = null;
let started = false;

/** Pages load with errors shown, the sidebar loads quietly in the background */
export function loadOverview(showErrors = false): Promise<void> {
  started = true;
  pending ??= api
    .get<OverviewData>('/overview', !showErrors)
    .then((data) => overview.set(data))
    .catch(() => {})
    .finally(() => (pending = null));
  return pending;
}

// Another device may have changed something meanwhile
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => started && void loadOverview());
}

export async function dismissTask(taskKey: string) {
  overview.update((o) => o && { ...o, dismissedTaskKeys: [...o.dismissedTaskKeys, taskKey] });
  await api.post('/overview/dismissals', { taskKey }).catch(() => loadOverview());
}

export async function restoreTask(taskKey: string) {
  overview.update((o) => o && { ...o, dismissedTaskKeys: o.dismissedTaskKeys.filter((k) => k !== taskKey) });
  await api.delete('/overview/dismissals', { taskKey }).catch(() => loadOverview());
}

/** Leaving "Tracks": newer activity of others counts as new from now on, on every device */
export async function markTracksSeen() {
  const res = await api.post<{ tracksSeenAt: string }>('/overview/seen', undefined, true).catch(() => null);
  if (res) overview.update((o) => o && { ...o, tracksSeenAt: res.tracksSeenAt });
}
