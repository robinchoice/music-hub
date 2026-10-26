import { captureException } from './monitoring.server';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import dns from 'node:dns';
import { dev } from '$app/environment';

// Docker's embedded DNS doesn't answer AAAA queries, which otherwise stalls
// the AAAA-before-A lookup order until it times out.
dns.setDefaultResultOrder('ipv4first');

/**
 * Proxy /api requests to the API service in production.
 * In dev, Vite's proxy does the same for the browser, fetches in server loads land here.
 */
const API_ORIGIN = process.env.API_INTERNAL_URL || (dev ? 'http://localhost:3000' : 'http://api:3000');

// Public content for agents comes from the API, see apps/api/src/routes/agents.ts
const AGENT_PATH = /^\/llms(-full)?\.txt$|\.md$/;

// The CSP comes from svelte.config.js. Browsers ignore HSTS over plain HTTP,
// so it is harmless in dev.
const SECURITY_HEADERS = {
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

export const handle: Handle = async ({ event, resolve }) => {
  const { pathname, search } = event.url;
  const response =
    pathname.startsWith('/api/') || AGENT_PATH.test(pathname)
      ? await proxy(event.request, `${API_ORIGIN}${pathname}${search}`)
      : ((await markdown(event.request, event.url)) ?? (await resolve(event)));
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
  return response;
};

// Agents that ask for Markdown get a public page as its .md, all others the HTML
async function markdown(request: Request, url: URL) {
  if (request.method !== 'GET' || !request.headers.get('accept')?.includes('text/markdown')) return;
  const path = url.pathname === '/' ? '/index.md' : `${url.pathname.replace(/\/$/, '')}.md`;
  const response = await proxy(request, `${API_ORIGIN}${path}${url.search}`);
  if (response.ok) return response;
}

async function proxy(request: Request, target: string) {
  const headers = new Headers(request.headers);
  headers.delete('host');

  const init: RequestInit & { duplex: 'half' } = {
    method: request.method,
    headers,
    body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : null,
    duplex: 'half',
    // A redirect (e.g. a paid download to its short-lived bucket URL) goes to the browser, not through here
    redirect: 'manual',
  };
  const res = await fetch(target, init);

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

export const handleError: HandleServerError = ({ error, status }) => {
  if (status >= 500) captureException(error);
};
