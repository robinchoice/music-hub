import { type Passkey } from '@music-hub/shared';
import { type PublicKeyCredentialCreationOptionsJSON, type PublicKeyCredentialRequestOptionsJSON, sendSignal, startAuthentication, startRegistration } from '@simplewebauthn/browser';
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
let authRevision = 0;

export async function checkAuth() {
  const revision = authRevision;
  try {
    const res = await api.get<{ user: User }>('/auth/me', true);
    if (revision === authRevision) user.set(res.user);
  } catch {
    if (revision === authRevision) user.set(null);
  } finally {
    authLoading.set(false);
  }
}

// updates: the unticked checkbox for update mails, counts once the link is opened
export async function register(name: string, email: string, password: string, updates = false) {
  const res = await api.post<{ user: User }>('/auth/register', { name, email, password, updates });
  authRevision++;
  user.set(res.user);
  return res.user;
}

export async function login(email: string, password: string) {
  const res = await api.post<{ user: User }>('/auth/login', { email, password });
  authRevision++;
  user.set(res.user);
  return res.user;
}

export async function sendMagicLink(email: string, next?: string, updates = false) {
  return api.post('/auth/magic-link', { email, next, updates });
}

// Silent: the verify page shows the error itself
export async function verifyToken(token: string, password?: string) {
  const res = await api.post<{ user: User }>('/auth/verify', { token, password }, true);
  authRevision++;
  user.set(res.user);
  return res.user;
}

export async function logout() {
  await api.post('/auth/logout');
  authRevision++;
  user.set(null);
}

// The code from the same mail, for when the link opens in another browser
export async function verifyCode(email: string, code: string) {
  const res = await api.post<{ user: User }>('/auth/code/verify', { email, code });
  authRevision++;
  user.set(res.user);
}

// autofill: the conditional request behind the address field, silent until
// the user picks a passkey there. The button asks right away.
export async function passkeyLogin(autofill: boolean, signal: AbortSignal) {
  signal.throwIfAborted();
  const options = await api.post<PublicKeyCredentialRequestOptionsJSON>(
    '/auth/passkeys/login/options',
    undefined,
    autofill,
  );
  signal.throwIfAborted();
  const response = await startAuthentication({ optionsJSON: options, useBrowserAutofill: autofill });
  signal.throwIfAborted();
  try {
    const res = await api.post<{ user: User }>('/auth/passkeys/login', { response });
    authRevision++;
    user.set(res.user);
  } catch (err) {
    // Removed in the settings, still on the device: the browser may forget it
    if (err instanceof Error && 'code' in err && err.code === 'passkeyUnknown')
      sendSignal({ signalName: 'unknownCredential', rpID: options.rpId!, credentialID: response.id }).catch(() => {});
    throw err;
  }
}

export async function listPasskeys() {
  return (await api.get<{ passkeys: Passkey[] }>('/auth/passkeys')).passkeys;
}

export async function addPasskey() {
  const options = await api.post<PublicKeyCredentialCreationOptionsJSON>('/auth/passkeys/register/options');
  const response = await startRegistration({ optionsJSON: options });
  return (await api.post<{ passkey: Passkey }>('/auth/passkeys/register', { response })).passkey;
}

export function removePasskey(id: string) {
  return api.delete(`/auth/passkeys/${encodeURIComponent(id)}`);
}
