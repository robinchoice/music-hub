import type { Handle } from '@sveltejs/kit';

/**
 * Proxy /api requests to the API service in production.
 * In dev, Vite's proxy handles this — this hook only fires
 * in the built/deployed SvelteKit server.
 */
const API_ORIGIN = process.env.API_INTERNAL_URL || 'http://api:3000';

export const handle: Handle = async ({ event, resolve }) => {
  if (event.url.pathname.startsWith('/api/')) {
    const target = `${API_ORIGIN}${event.url.pathname}${event.url.search}`;

    const headers = new Headers(event.request.headers);
    headers.delete('host');

    const res = await fetch(target, {
      method: event.request.method,
      headers,
      body: event.request.method !== 'GET' && event.request.method !== 'HEAD'
        ? event.request.body
        : undefined,
      // @ts-expect-error — Bun supports duplex
      duplex: 'half',
    });

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  }

  return resolve(event);
};
