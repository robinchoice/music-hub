import { writable } from 'svelte/store';
import { api } from '$lib/api/client.js';
import { user } from '$lib/stores/auth.js';

export type ContactRequest = {
  id: string;
  message: string;
  createdAt: string;
  from: { id: string; name: string; avatarUrl: string | null; handle: string | null; bio: string | null };
  track: { id: string; name: string } | null;
};

/** Contact requests waiting on "Für dich"; the sidebar and the bottom bar count them with the tasks */
export const requests = writable<ContactRequest[]>([]);

// Another account in the same tab never sees the requests of the previous one
let owner: string | null = null;
user.subscribe(($user) => {
  const id = $user?.id ?? null;
  if (id !== owner) requests.set([]);
  owner = id;
});

export async function loadRequests() {
  if (!owner) return;
  const res = await api.get<{ requests: ContactRequest[] }>('/requests', true).catch(() => null);
  if (res) requests.set(res.requests);
}

export function dropRequest(id: string) {
  requests.update((list) => list.filter((r) => r.id !== id));
}

// Another device may have answered meanwhile
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => void loadRequests());
}
