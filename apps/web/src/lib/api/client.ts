import { z } from 'zod';

import { toastError } from '$lib/stores/toast.js';
import { demoMode } from '$lib/demo/mode.js';
import { t } from '$lib/i18n/index.js';

const errorAnswer = z.object({ error: z.string(), code: z.string().exactOptional() });

type FetchOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  silent?: boolean;
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
    body: body ? JSON.stringify(body) : null,
  });

  if (!res.ok) {
    const error = errorAnswer.safeParse(await res.json().catch(() => null)).data;
    // Invalid input comes back as a validation object, a few API messages are still English codes
    const text = typeof error?.error === 'string' ? error.error : null;
    const message = (text && t().common.apiErrors[text]) ?? text ?? (res.status === 400 ? t().common.checkInput : t().common.failed);
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
