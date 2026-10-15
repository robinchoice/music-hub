import { writable } from 'svelte/store';
import { api } from '$lib/api/client.js';

type User = {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  versionMails?: boolean;
  // Since when update mails are on, ISO date; null = off
  updatesSince?: string | null;
  // Missing while an older API is still running
  isAdmin?: boolean;
} | null;

export const user = writable<User>(null);
export const authLoading = writable(true);

export async function checkAuth() {
  try {
    const res = await api.get<{ user: User }>('/auth/me', true);
    user.set(res.user);
  } catch {
    user.set(null);
  } finally {
    authLoading.set(false);
  }
}

// updates: the unticked checkbox for update mails, counts once the link is opened
export async function register(name: string, email: string, password: string, updates = false) {
  const res = await api.post<{ user: User }>('/auth/register', { name, email, password, updates });
  user.set(res.user);
  return res.user;
}

export async function login(email: string, password: string) {
  const res = await api.post<{ user: User }>('/auth/login', { email, password });
  user.set(res.user);
  return res.user;
}

export async function sendMagicLink(email: string, next?: string, updates = false) {
  return api.post('/auth/magic-link', { email, next, updates });
}

// Silent: the verify page shows the error itself
export async function verifyToken(token: string, password?: string) {
  const res = await api.post<{ user: User }>('/auth/verify', { token, password }, true);
  user.set(res.user);
  return res.user;
}

export async function logout() {
  await api.post('/auth/logout');
  user.set(null);
}
