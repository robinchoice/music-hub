import { toastError } from '$lib/stores/toast.js';
import { demoMode } from '$lib/demo/mode.js';

type FetchOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  silent?: boolean;
};

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
    const error = await res.json().catch(() => ({ error: res.statusText }));
    const message = error.error || 'Request failed';
    if (!silent) toastError(message);
    throw Object.assign(new Error(message), { status: res.status });
  }

  return res.json();
}

export const api = {
  get: <T>(path: string, silent = false) => request<T>(path, { silent }),
  post: <T>(path: string, body?: unknown, silent = false) =>
    request<T>(path, { method: 'POST', body, silent }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body }),
};
