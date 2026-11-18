import OAuth2Server from '@node-oauth/oauth2-server';
import { OAuthClientMetadataSchema } from '@modelcontextprotocol/sdk/shared/auth.js';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { zValidator } from '@hono/zod-validator';
import { and, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import { mcpClients, mcpGrants, users } from '@music-hub/db';
import { generateToken, hashToken, requireAuth } from '../middleware/auth.js';
import { clientIp, rateLimit, tooManyRequests } from '../lib/rate-limit.js';
import { MCP_SCOPE, mcpResource, oauthIssuer, oauthServer, revokeMcpToken } from '../mcp/oauth.js';
import type { AppEnv } from '../types.js';

const registrations = rateLimit('mcp-registrations', 20, 60 * 60_000);
const exchanges = rateLimit('mcp-exchanges', 100, 15 * 60_000);
const consents = rateLimit('mcp-consents', 30, 15 * 60_000);
const authorizationSchema = z.object({
  client_id: z.uuid(), redirect_uri: z.url(), response_type: z.literal('code'),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/), code_challenge_method: z.literal('S256'),
  scope: z.literal(MCP_SCOPE).default(MCP_SCOPE), state: z.string().min(1).max(1024), resource: z.string(),
});

function oauthError(c: Context, error: unknown) {
  if (!(error instanceof OAuth2Server.OAuthError) || error.code >= 500) throw error;
  if (error.code === 401) c.header('WWW-Authenticate', 'Basic realm="Music Hub"');
  return c.json({ error: error.name, error_description: error.message }, error.code === 401 ? 401 : 400);
}

function safeRedirect(value: string) {
  const url = new URL(value);
  return !url.username && !url.password && !url.hash &&
    (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
}

async function authorization(c: Context<AppEnv>, input: unknown) {
  const parsed = authorizationSchema.safeParse(input);
  if (!parsed.success || parsed.data.resource !== mcpResource()) return null;
  const [client] = await c.get('db').select().from(mcpClients).where(eq(mcpClients.id, parsed.data.client_id));
  return client?.redirectUris.includes(parsed.data.redirect_uri) ? { input: parsed.data, client } : null;
}

export const mcpMetadataRoutes = new Hono<AppEnv>()
  .use('*', cors({ origin: '*' }))
  .get('/.well-known/oauth-protected-resource/mcp', (c) => c.json({
    resource: mcpResource(), authorization_servers: [oauthIssuer()], scopes_supported: [MCP_SCOPE], bearer_methods_supported: ['header'],
  }))
  .get('/.well-known/oauth-authorization-server', (c) => c.json({
    issuer: oauthIssuer(), authorization_endpoint: `${oauthIssuer()}/api/v1/oauth/authorize`,
    token_endpoint: `${oauthIssuer()}/api/v1/oauth/token`, registration_endpoint: `${oauthIssuer()}/api/v1/oauth/register`,
    revocation_endpoint: `${oauthIssuer()}/api/v1/oauth/revoke`,
    scopes_supported: [MCP_SCOPE], response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    authorization_response_iss_parameter_supported: true,
  }));

export const mcpOAuthRoutes = new Hono<AppEnv>()
  .use('*', bodyLimit({ maxSize: 16 * 1024 }))
  .use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); c.header('Referrer-Policy', 'no-referrer'); await next(); })
  .use('/register', cors({ origin: '*' }))
  .use('/token', cors({ origin: '*' }))
  .use('/revoke', cors({ origin: '*' }))
  .post('/register', async (c) => {
    const db = c.get('db');
    if (!await registrations.hit(db, clientIp(c))) return tooManyRequests(c);
    const parsed = OAuthClientMetadataSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_client_metadata' }, 400);
    const metadata = parsed.data;
    const method = metadata.token_endpoint_auth_method ?? 'client_secret_basic';
    if (!['none', 'client_secret_post', 'client_secret_basic'].includes(method) ||
      !metadata.redirect_uris.length || metadata.redirect_uris.length > 10 || !metadata.redirect_uris.every(safeRedirect) ||
      (metadata.client_name?.length ?? 0) > 100 ||
      metadata.grant_types?.some((g) => !['authorization_code', 'refresh_token'].includes(g)) ||
      metadata.response_types?.some((r) => r !== 'code') || (metadata.scope && metadata.scope !== MCP_SCOPE)) {
      return c.json({ error: 'invalid_client_metadata' }, 400);
    }
    const secret = method === 'none' ? null : generateToken();
    const [client] = await db.insert(mcpClients).values({ name: metadata.client_name || 'MCP client', redirectUris: metadata.redirect_uris,
      authMethod: method, secretHash: secret ? await hashToken(secret) : null }).returning();
    return c.json({ client_id: client!.id, client_id_issued_at: Math.floor(Date.now() / 1000),
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_name: client!.name, redirect_uris: client!.redirectUris, token_endpoint_auth_method: method,
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: MCP_SCOPE }, 201);
  })
  .get('/authorize', (c) => c.redirect(`${oauthIssuer()}/oauth/consent?${new URL(c.req.url).searchParams}`))
  .get('/request', requireAuth, async (c) => {
    const found = await authorization(c, c.req.query());
    if (!found) return c.json({ error: 'invalid_request' }, 400);
    const [account] = await c.get('db').select({ id: users.id, email: users.email }).from(users).where(eq(users.id, c.get('userId')));
    return c.json({ client: found.client.name, redirectUri: found.input.redirect_uri, scope: MCP_SCOPE, account });
  })
  .post('/authorize', requireAuth, zValidator('json', z.object({ request: authorizationSchema, allow: z.boolean(), accountId: z.uuid() })), async (c) => {
    if (c.req.header('origin') !== oauthIssuer()) return c.json({ error: 'Forbidden' }, 403);
    if (!await consents.hit(c.get('db'), c.get('userId'))) return tooManyRequests(c);
    const { request, allow, accountId } = c.req.valid('json');
    if (accountId !== c.get('userId')) return c.json({ error: 'Forbidden' }, 403);
    const found = await authorization(c, request);
    if (!found) return c.json({ error: 'invalid_request' }, 400);
    const target = new URL(found.input.redirect_uri);
    if (!allow) {
      target.searchParams.set('error', 'access_denied');
      target.searchParams.set('state', found.input.state);
    } else {
      const response = new OAuth2Server.Response();
      try {
        await oauthServer(c.get('db')).authorize(new OAuth2Server.Request({ method: 'GET', headers: {}, query: found.input }), response,
          { authenticateHandler: { handle: async () => ({ id: c.get('userId') }) } });
      } catch (error) { return oauthError(c, error); }
      const redirect = z.url().parse(response.get('location'));
      target.href = redirect;
    }
    target.searchParams.set('iss', oauthIssuer());
    return c.json({ redirect: target.href });
  })
  .post('/token', async (c) => {
    if (!await exchanges.hit(c.get('db'), clientIp(c))) return tooManyRequests(c);
    if (!c.req.header('content-type')?.startsWith('application/x-www-form-urlencoded')) return c.json({ error: 'invalid_request' }, 400);
    const body = await c.req.parseBody();
    if ((body.resource !== undefined && body.resource !== mcpResource()) || !['authorization_code', 'refresh_token'].includes(String(body.grant_type))) {
      return c.json({ error: 'invalid_target' }, 400);
    }
    const response = new OAuth2Server.Response();
    try {
      await oauthServer(c.get('db')).token(new OAuth2Server.Request({ method: 'POST', headers: { ...c.req.header(), 'transfer-encoding': 'chunked' }, body, query: {} }), response);
    } catch (error) { return oauthError(c, error); }
    return new Response(JSON.stringify(response.body as unknown), { status: 200, headers: { ...response.headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  })
  .post('/revoke', async (c) => {
    if (!await exchanges.hit(c.get('db'), clientIp(c))) return tooManyRequests(c);
    const body = await c.req.parseBody();
    let id = body.client_id;
    let secret = body.client_secret;
    const basic = c.req.header('authorization');
    if (basic?.startsWith('Basic ')) {
      const credentials = Buffer.from(basic.slice(6), 'base64').toString();
      const split = credentials.indexOf(':');
      id = credentials.slice(0, split);
      secret = credentials.slice(split + 1);
    }
    if (typeof id !== 'string' || typeof body.token !== 'string') return c.json({ error: 'invalid_request' }, 400);
    const server = oauthServer(c.get('db'));
    if (!await server.options.model.getClient(id, typeof secret === 'string' ? secret : undefined)) return c.json({ error: 'invalid_client' }, 401);
    await revokeMcpToken(c.get('db'), body.token, id);
    return c.body(null, 200);
  });

export const mcpConnectionRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)
  .get('/', async (c) => {
    const connections = await c.get('db').select({ id: mcpGrants.id, client: mcpClients.name, createdAt: mcpGrants.createdAt, expiresAt: mcpGrants.expiresAt })
      .from(mcpGrants).innerJoin(mcpClients, eq(mcpClients.id, mcpGrants.clientId))
      .where(and(eq(mcpGrants.userId, c.get('userId')), gt(mcpGrants.expiresAt, new Date())));
    return c.json({ connections, scope: MCP_SCOPE });
  })
  .delete('/:id', zValidator('param', z.object({ id: z.uuid() })), async (c) => {
    if (c.req.header('origin') !== oauthIssuer()) return c.json({ error: 'Forbidden' }, 403);
    await c.get('db').delete(mcpGrants).where(and(eq(mcpGrants.id, c.req.valid('param').id), eq(mcpGrants.userId, c.get('userId'))));
    return c.json({ ok: true });
  });
