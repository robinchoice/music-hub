import { writable, derived, get } from 'svelte/store';
import { api } from '$lib/api/client.js';
import { user } from '$lib/stores/auth.js';
import { indexOverview, tasksFor, type OverviewData } from '$lib/utils/overview.js';

/** Answer of GET /overview; null until the first load */
export const overview = writable<OverviewData | null>(null);

/** The last load failed and there is nothing to show */
export const overviewFailed = writable(false);

/** Lookups for the signed-in user */
export const overviewIndex = derived([overview, user], ([$overview, $user]) =>
  $overview && $user ? indexOverview($overview, $user.id) : null,
);

/** Open tasks on "Für dich", newest first; the sidebar and the bottom bar show their count */
export const tasks = derived(overviewIndex, ($ix) => ($ix ? tasksFor($ix) : []));

let pending: Promise<void> | null = null;
let started = false;
// The account the loaded answer belongs to
let owner: string | null = null;

// Another account in the same tab never sees the answer of the previous one
user.subscribe(($user) => {
  const id = $user?.id ?? null;
  if (id === owner) return;
  owner = id;
  pending = null;
  overview.set(null);
  overviewFailed.set(false);
});

/** Pages load with errors shown, the sidebar loads quietly in the background */
export function loadOverview(showErrors = false): Promise<void> {
  started = true;
  if (!pending) {
    const forUser = owner;
    overviewFailed.set(false);
    const request: Promise<void> = api
      .get<OverviewData>('/overview', !showErrors)
      .then((data) => {
        if (owner === forUser) overview.set(data);
      })
      .catch(() => {
        if (owner === forUser && !get(overview)) overviewFailed.set(true);
      })
      .finally(() => {
        if (pending === request) pending = null;
      });
    pending = request;
  }
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

/** Leaving a project page: newer activity of others counts as new from now on, on every device */
export async function markTracksSeen() {
  const res = await api.post<{ tracksSeenAt: string }>('/overview/seen', undefined, true).catch(() => null);
  if (res) overview.update((o) => o && { ...o, tracksSeenAt: res.tracksSeenAt });
}
