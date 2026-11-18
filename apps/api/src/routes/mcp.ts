import OAuth2Server from '@node-oauth/oauth2-server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { bearerToken } from '../middleware/auth.js';
import { MCP_SCOPE, oauthIssuer, oauthServer } from '../mcp/oauth.js';
import { rateLimit, tooManyRequests } from '../lib/rate-limit.js';
import { projectRoutes } from './projects.js';
import { trackRoutes } from './tracks.js';
import { versionRoutes } from './versions.js';
import { commentRoutes } from './comments.js';
import { overviewRoutes } from './overview.js';
import { deliveryRoutes } from './deliveries.js';
import type { AppEnv } from '../types.js';

const reads = rateLimit('mcp-reads', 120, 60_000);
const calls = rateLimit('mcp-calls', 120, 60_000);
const id = z.uuid();

export const mcpRoutes = new Hono<AppEnv>()
  // No cookies: browser clients explicitly carry a dedicated, read-only bearer token.
  .use('*', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type', 'MCP-Protocol-Version', 'MCP-Session-Id'], exposeHeaders: ['WWW-Authenticate'] }))
  .all('/', async (c) => {
    const token = bearerToken(c);
    if (!token) return challenge();
    let userId: string;
    let redirectUris: string[];
    try {
      const auth = await oauthServer(c.get('db')).authenticate(
        new OAuth2Server.Request({ method: c.req.method, headers: { authorization: `Bearer ${token}` }, query: {} }),
        new OAuth2Server.Response(), { scope: [MCP_SCOPE] });
      userId = z.object({ id }).parse(auth.user).id;
      redirectUris = z.array(z.url()).parse(auth.client.redirectUris);
    } catch (error) {
      if (!(error instanceof OAuth2Server.OAuthError) || error.code >= 500) throw error;
      return challenge(true);
    }
    const origin = c.req.header('origin');
    if (origin) {
      if (origin !== oauthIssuer() && !redirectUris.some((uri) => new URL(uri).origin === origin)) return c.json({ error: 'Forbidden' }, 403);
    }
    c.header('Cache-Control', 'no-store');
    if (!await reads.hit(c.get('db'), userId)) return tooManyRequests(c);
    // A context created here is the only source of mcpUserId. It never comes from an HTTP header.
    const api = new Hono<AppEnv>()
      .use('*', async (inner, next) => { inner.set('db', c.get('db')); inner.set('mcpUserId', userId); await next(); })
      .route('/projects', projectRoutes).route('/tracks', trackRoutes).route('/versions', versionRoutes)
      .route('/comments', commentRoutes).route('/overview', overviewRoutes).route('/deliveries', deliveryRoutes);
    const server = new McpServer({ name: 'Music Hub', version: '1.0.0' });
    const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
    const read = async (path: string) => {
      if (!await calls.hit(c.get('db'), userId)) return { isError: true, content: [{ type: 'text' as const, text: 'Too many requests' }] };
      const response = await api.request(path, { method: 'GET', headers: { 'accept-language': c.req.header('accept-language') ?? 'en' } });
      return { isError: !response.ok, content: [{ type: 'text' as const, text: JSON.stringify(await response.json() as unknown, (key, value: unknown) => {
        // A guest link can authorize writes; read-only tools must not hand it out.
        return key === 'linkToken' ? undefined : value;
      }) }] };
    };
    server.registerTool('list_projects', { description: 'List your projects. Projekte auflisten.', inputSchema: { archived: z.boolean().default(false) }, annotations },
      ({ archived }) => read(`/projects?archived=${archived ? '1' : '0'}`));
    server.registerTool('get_project', { description: 'Read a project and your rights. Projekt und eigene Rechte lesen.', inputSchema: { projectId: id }, annotations },
      ({ projectId }) => read(`/projects/${projectId}`));
    server.registerTool('list_tracks', { description: 'Read tracks and production stages (board). Tracks und Produktionsphasen (Board) lesen.', inputSchema: { projectId: id }, annotations },
      ({ projectId }) => read(`/tracks/project/${projectId}`));
    server.registerTool('list_versions', { description: 'Read versions, measurements and open comment counts. Versionen, Messwerte und offene Kommentare zählen.', inputSchema: { trackId: id }, annotations },
      ({ trackId }) => read(`/versions/track/${trackId}`));
    server.registerTool('get_feedback', { description: 'Read comments, resolved state, reviews and waiting people. Kommentare, Erledigt-Status, Rückmeldungen und ausstehendes Feedback lesen.', inputSchema: { versionId: id }, annotations },
      ({ versionId }) => read(`/comments/version/${versionId}`));
    server.registerTool('get_overview', { description: 'Read recent activity and data used by board and plan, across your projects. Aktivitäten und Daten für Board und Plan der eigenen Projekte lesen.', inputSchema: {}, annotations },
      () => read('/overview'));
    server.registerTool('list_deliveries', { description: 'Read project deliveries; requires project ownership. Aufträge des Projekts lesen; erfordert Owner-Rechte.', inputSchema: { projectId: id }, annotations },
      ({ projectId }) => read(`/deliveries/project/${projectId}`));
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true, maxRequestBodySize: 16 * 1024 });
    await server.connect(transport);
    try { return await transport.handleRequest(c.req.raw); }
    finally { await server.close(); }
  });

function challenge(invalid = false) {
  return new Response(null, { status: 401, headers: {
    'WWW-Authenticate': `Bearer resource_metadata="${oauthIssuer()}/.well-known/oauth-protected-resource/mcp", scope="${MCP_SCOPE}"${invalid ? ', error="invalid_token"' : ''}`,
    'Cache-Control': 'no-store',
  } });
}
