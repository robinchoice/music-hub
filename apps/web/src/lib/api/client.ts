import { toastError } from '$lib/stores/toast.js';
import { demoMode } from '$lib/demo/mode.js';

type FetchOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  silent?: boolean;
};

const ENGLISH_ERRORS: Record<string, string> = {
  'Not found': 'Nicht gefunden. Vielleicht wurde es gelöscht.',
  Forbidden: 'Dafür fehlen dir die Rechte.',
  Unauthorized: 'Bitte melde dich neu an.',
  'Internal server error': 'Auf dem Server ging etwas schief. Versuch es bitte noch einmal.',
  Expired: 'Der Link ist abgelaufen.',
  'Password required': 'Dafür braucht es das Passwort.',
  'Name is required': 'Bitte gib einen Namen ein.',
  'User already a member': 'Die Person ist schon im Projekt.',
  'Cannot remove own owner membership': 'Als Besitzer kannst du dich nicht selbst entfernen.',
  'Cannot change own owner role': 'Deine eigene Besitzer-Rolle lässt sich nicht ändern.',
  'No stems found': 'Keine Spuren gefunden.',
  'Comments disabled': 'Kommentare sind hier ausgeschaltet.',
  'Push not configured': 'Benachrichtigungen sind auf diesem Server nicht eingerichtet.',
};

export function isApiError(error: unknown) {
  return error instanceof Error && 'status' in error;
}

async function request<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, silent = false } = options;

  if (demoMode) {
    const { demoRequest } = await import('$lib/demo/backend.js');
    try {
      return await demoRequest<T>(method, path, body);
    } catch (e) {
      if (!silent) toastError((e as Error).message);
      throw e;
    }
  }

  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => null);
    // Invalid input comes back as a validation object, a few API messages are still English
    const text = typeof error?.error === 'string' ? error.error : null;
    const message = (text && ENGLISH_ERRORS[text]) ?? text ?? (res.status === 400 ? 'Bitte prüfe deine Eingaben.' : 'Das hat nicht geklappt. Versuch es bitte noch einmal.');
    if (!silent) toastError(message);
    throw Object.assign(new Error(message), { status: res.status, code: error?.code });
  }

  return res.json();
}

export const api = {
  get: <T>(path: string, silent = false) => request<T>(path, { silent }),
  post: <T>(path: string, body?: unknown, silent = false) =>
    request<T>(path, { method: 'POST', body, silent }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body }),
};
