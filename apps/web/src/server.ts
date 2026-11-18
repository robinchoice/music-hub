import { createServer, request, type RequestListener } from 'node:http';

// adapter-node generates this handler during the web build.
const output = '../build/handler.js';
const { handler } = await import(output) as { handler: RequestListener };

const server = createServer((incoming, response) => {
  const path = incoming.url ?? '/';
  const pathname = path.split('?')[0];
  // OAuth clients exchange forms without a browser Origin. Only these two
  // endpoints bypass SvelteKit's form CSRF gate; they never accept cookies as auth.
  if (pathname !== '/api/v1/oauth/token' && pathname !== '/api/v1/oauth/revoke') {
    handler(incoming, response);
    return;
  }
  const target = new URL(path, process.env.API_INTERNAL_URL || 'http://api:3000');
  const upstream = request(target, { method: incoming.method, headers: { ...incoming.headers, host: target.host } }, (result) => {
    response.writeHead(result.statusCode ?? 502, { ...result.headers,
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'strict-transport-security': 'max-age=31536000' });
    result.pipe(response);
  });
  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(502);
    response.end();
  });
  incoming.on('aborted', () => upstream.destroy());
  response.on('close', () => upstream.destroy());
  incoming.pipe(upstream);
});
server.listen(Number(process.env.PORT || 3000), process.env.HOST || '0.0.0.0');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 30_000).unref();
  });
}
