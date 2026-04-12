import { writable } from 'svelte/store';
import { api } from '$lib/api/client.js';

type User = {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
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

export async function register(name: string, email: string, password: string) {
  const res = await api.post<{ user: User }>('/auth/register', { name, email, password });
  user.set(res.user);
  return res.user;
}

export async function login(email: string, password: string) {
  const res = await api.post<{ user: User }>('/auth/login', { email, password });
  user.set(res.user);
  return res.user;
}

export async function sendMagicLink(email: string) {
  return api.post('/auth/magic-link', { email });
}

export async function verifyToken(token: string) {
  const res = await api.post<{ user: User }>('/auth/verify', { token });
  user.set(res.user);
  return res.user;
}

export async function logout() {
  await api.post('/auth/logout');
  user.set(null);
}
