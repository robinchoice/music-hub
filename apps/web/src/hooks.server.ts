import type { Handle } from '@sveltejs/kit';
import dns from 'node:dns';

// Docker's embedded DNS doesn't answer AAAA queries, which otherwise stalls
// the AAAA-before-A lookup order until it times out.
dns.setDefaultResultOrder('ipv4first');

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

    // fetch() already decompresses the body, so forwarding the upstream's
    // content-encoding/content-length would mismatch the actual bytes sent
    // and abort the client's HTTP/2 stream mid-response.
    const responseHeaders = new Headers(res.headers);
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
    });
  }

  return resolve(event);
};
