import { toastError } from '$lib/stores/toast.js';

type FetchOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  silent?: boolean;
};

async function request<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, silent = false } = options;

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
    throw new Error(message);
  }

  return res.json();
}

export const api = {
  get: <T>(path: string, silent = false) => request<T>(path, { silent }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body }),
};
