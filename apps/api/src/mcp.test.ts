import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { createDb, deliveries, migrateDb, mcpClients, mcpGrants, mcpTokens, projectMembers, projectShareLinks, projects, sessions, tracks, users, versions } from '@music-hub/db';
import { rightsOfRoles } from '@music-hub/shared';
import { generateToken, hashToken } from './middleware/auth.js';
import { projectRoutes } from './routes/projects.js';
import { mcpRoutes } from './routes/mcp.js';
import { mcpMetadataRoutes, mcpOAuthRoutes, mcpConnectionRoutes } from './routes/mcp-oauth.js';
import type { AppEnv } from './types.js';

const db = createDb(process.env.DATABASE_URL!);
const origin = process.env.APP_URL!;
const resource = `${origin}/mcp`;
const app = new Hono<AppEnv>().use('*', async (c, next) => { c.set('db', db); await next(); })
  .route('/', mcpMetadataRoutes).route('/mcp', mcpRoutes).route('/api/v1/oauth', mcpOAuthRoutes)
  .route('/api/v1/mcp/connections', mcpConnectionRoutes).route('/api/v1/projects', projectRoutes);
const userIds: string[] = [];
const clientIds: string[] = [];
let own: { id: string; token: string }, other: { id: string; token: string };
const guestToken = generateToken();
let ownProject: string, foreignProject: string, foreignTrack: string, foreignVersion: string;
const answer = z.object({ access_token: z.string(), refresh_token: z.string(), scope: z.literal('music:read') });
const call = (path: string, method = 'GET', body?: unknown, token?: string, requestOrigin = origin) => app.request(`${origin}${path}`, {
  method, headers: { 'content-type': 'application/json', origin: requestOrigin, ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: body === undefined ? null : JSON.stringify(body),
});
const form = (path: string, body: Record<string, string>, authorization?: string) => app.request(`${origin}/api/v1/oauth/${path}`, {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(authorization ? { authorization } : {}) }, body: new URLSearchParams(body),
});
async function person() {
  const [user] = await db.insert(users).values({ email: `mcp-${crypto.randomUUID()}@example.com`, name: 'MCP test' }).returning();
  userIds.push(user!.id);
  const token = generateToken();
  await db.insert(sessions).values({ userId: user!.id, tokenHash: await hashToken(token), expiresAt: new Date(Date.now() + 300_000) });
  return { id: user!.id, token };
}
async function register(method: 'none' | 'client_secret_post' | 'client_secret_basic' = 'none') {
  const res = await call('/api/v1/oauth/register', 'POST', { client_name: 'MCP test', redirect_uris: ['http://127.0.0.1:6274/callback'], token_endpoint_auth_method: method });
  expect(res.status).toBe(201);
  const client = z.object({ client_id: z.uuid(), client_secret: z.string().optional() }).parse(await res.json());
  clientIds.push(client.client_id);
  return client;
}
async function approval(clientId: string, userToken = own.token) {
  const verifier = generateToken();
  const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url');
  const request = { client_id: clientId, redirect_uri: 'http://127.0.0.1:6274/callback', response_type: 'code',
    code_challenge: challenge, code_challenge_method: 'S256', scope: 'music:read', state: generateToken(), resource };
  const res = await call('/api/v1/oauth/authorize', 'POST', { request, allow: true, accountId: own.id }, userToken);
  expect(res.status).toBe(200);
  const redirect = new URL(z.object({ redirect: z.url() }).parse(await res.json()).redirect);
  expect(redirect.searchParams.get('state')).toBe(request.state);
  expect(redirect.searchParams.get('iss')).toBe(origin);
  return { verifier, request, code: redirect.searchParams.get('code')! };
}
async function issue() {
  const client = await register();
  const approved = await approval(client.client_id);
  const res = await form('token', { grant_type: 'authorization_code', client_id: client.client_id,
    redirect_uri: approved.request.redirect_uri, code: approved.code, code_verifier: approved.verifier, resource });
  if (!res.ok) throw new Error(await res.text());
  expect(res.status).toBe(200);
  return { client, approved, tokens: answer.parse(await res.json()) };
}
async function connect(token: string) {
  const client = new Client({ name: 'Music Hub tests', version: '1' });
  const transport = new StreamableHTTPClientTransport(new URL(resource), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: async (input, init) => app.request(new Request(input, init)),
  });
  await client.connect(transport);
  return client;
}

beforeAll(async () => {
  await migrateDb(process.env.DATABASE_URL!);
  own = await person(); other = await person();
  for (const user of [own, other]) {
    const [project] = await db.insert(projects).values({ name: user.id, createdById: user.id }).returning();
    await db.insert(projectMembers).values({ projectId: project!.id, userId: user.id, role: 'owner', ...rightsOfRoles(['owner']) });
    if (user === own) ownProject = project!.id;
    else foreignProject = project!.id;
  }
  const [link] = await db.insert(projectShareLinks).values({ projectId: ownProject, token: guestToken, createdById: own.id }).returning();
  await db.insert(deliveries).values({ projectLinkId: link!.id, projectId: ownProject, createdById: own.id, clientName: 'Client' });
  const [track] = await db.insert(tracks).values({ projectId: foreignProject, name: 'Foreign', createdById: other.id }).returning();
  foreignTrack = track!.id;
  const [version] = await db.insert(versions).values({ trackId: foreignTrack, versionNumber: 1, originalFileName: 'foreign.wav',
    originalFileKey: 'test/mcp/foreign.wav', fileSize: 1, mimeType: 'audio/wav', createdById: other.id }).returning();
  foreignVersion = version!.id;
});
afterAll(async () => {
  await db.delete(projects).where(inArray(projects.createdById, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
  if (clientIds.length) await db.delete(mcpClients).where(inArray(mcpClients.id, clientIds));
  await db.$client.end();
});

test('metadata, SDK handshake and fixed read tools preserve project boundaries', async () => {
  expect((await call('/mcp')).status).toBe(401);
  expect((await call('/mcp', 'POST', {}, own.token)).status).toBe(401);
  const metadata = await (await call('/.well-known/oauth-protected-resource/mcp')).json();
  expect(metadata).toMatchObject({ resource, authorization_servers: [origin] });
  const { tokens } = await issue();
  const before = await db.select({ seen: users.lastSeenAt }).from(users).where(eq(users.id, own.id));
  const client = await connect(tokens.access_token);
  try {
    const list = await client.listTools();
    expect(list.tools.map((t) => t.name)).toEqual(['list_projects', 'get_project', 'list_tracks', 'list_versions', 'get_feedback', 'get_overview', 'list_deliveries']);
    expect(list.tools.every((t) => t.annotations?.readOnlyHint && !t.annotations.destructiveHint)).toBe(true);
    const result = JSON.stringify(await client.callTool({ name: 'list_projects', arguments: {} }));
    expect(result).toContain(ownProject);
    expect(result).not.toContain(foreignProject);
    for (const [name, args] of [
      ['get_project', { projectId: foreignProject }], ['list_tracks', { projectId: foreignProject }],
      ['list_versions', { trackId: foreignTrack }], ['get_feedback', { versionId: foreignVersion }],
      ['list_deliveries', { projectId: foreignProject }],
    ] as const) {
      const denied = await client.callTool({ name, arguments: args });
      expect(denied.isError).toBe(true);
      expect(JSON.stringify(denied)).not.toContain('foreign.wav');
    }
    const overview = JSON.stringify(await client.callTool({ name: 'get_overview', arguments: {} }));
    expect(overview).not.toContain(foreignProject);
    expect((await client.callTool({ name: 'delete_project', arguments: { projectId: ownProject } })).isError).toBe(true);
    const delivery = JSON.stringify(await client.callTool({ name: 'list_deliveries', arguments: { projectId: ownProject } }));
    expect(delivery).toContain('Client');
    expect(delivery).not.toContain(guestToken);
    expect(delivery).not.toContain('linkToken');
    expect((await call('/api/v1/projects', 'POST', { name: 'Forbidden' }, tokens.access_token)).status).toBe(401);
    expect((await app.request(`${origin}/api/v1/projects`, { headers: { 'x-mcp-user-id': own.id } })).status).toBe(401);
    const direct = await call(`/api/v1/mcp/connections`, 'GET', undefined, tokens.access_token);
    expect(direct.status).toBe(401);
    expect(await db.select({ seen: users.lastSeenAt }).from(users).where(eq(users.id, own.id))).toEqual(before);
  } finally { await client.close(); }
});

test('PKCE, redirect, scope, resource, consent and single-use codes are enforced', async () => {
  const client = await register();
  const approved = await approval(client.client_id);
  const tokenBody = { grant_type: 'authorization_code', client_id: client.client_id, redirect_uri: approved.request.redirect_uri,
    code: approved.code, code_verifier: approved.verifier, resource };
  expect((await form('token', { ...tokenBody, resource: 'https://foreign.test/mcp' })).status).toBe(400);
  expect((await form('token', { ...tokenBody, code_verifier: 'x'.repeat(64) })).status).toBe(400);
  expect((await form('token', tokenBody)).status).toBe(400);
  for (const patch of [{ code_challenge_method: 'plain' }, { code_challenge: '' }, { scope: 'music:write' },
    { redirect_uri: 'https://foreign.test/callback' }, { resource: 'https://foreign.test/mcp' }]) {
    const rejected = await call('/api/v1/oauth/authorize', 'POST', { request: { ...approved.request, ...patch }, allow: true, accountId: own.id }, own.token);
    expect(rejected.status).toBe(400);
  }
  expect((await call('/api/v1/oauth/authorize', 'POST', { request: approved.request, allow: true, accountId: own.id }, own.token, 'https://foreign.test')).status).toBe(403);
  expect((await call('/api/v1/oauth/authorize', 'POST', { request: approved.request, allow: true, accountId: own.id })).status).toBe(401);
  expect((await call('/api/v1/oauth/authorize', 'POST', { request: approved.request, allow: true, accountId: other.id }, own.token)).status).toBe(403);
  const denied = z.object({ redirect: z.url() }).parse(await (await call('/api/v1/oauth/authorize', 'POST', { request: approved.request, allow: false, accountId: own.id }, own.token)).json());
  expect(new URL(denied.redirect).searchParams.get('error')).toBe('access_denied');
  const issued = await issue();
  expect((await form('token', { ...tokenBody, code: issued.approved.code, client_id: issued.client.client_id, code_verifier: issued.approved.verifier })).status).toBe(400);
  expect((await call('/api/v1/oauth/register', 'POST', { redirect_uris: ['https://test.test/#fragment'] })).status).toBe(400);
});

test('refresh rotation detects reuse and revokes the connection; other accounts cannot revoke it', async () => {
  const { tokens, client } = await issue();
  const connection = (await db.select().from(mcpGrants).where(and(eq(mcpGrants.clientId, client.client_id), eq(mcpGrants.userId, own.id))))[0]!;
  expect((await call(`/api/v1/mcp/connections/${connection.id}`, 'DELETE', undefined, other.token)).status).toBe(200);
  const refreshed = await form('token', { grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.refresh_token, resource });
  expect(refreshed.status).toBe(200);
  const next = answer.parse(await refreshed.json());
  expect(next.access_token).not.toBe(tokens.access_token);
  expect((await form('token', { grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.refresh_token })).status).toBe(400);
  expect((await call('/mcp', 'POST', {}, next.access_token)).status).toBe(401);
});

test('connections list no tokens, revocation and blocked or expired grants deny access', async () => {
  const { tokens, client } = await issue();
  const res = await call('/api/v1/mcp/connections', 'GET', undefined, own.token);
  const list = z.object({ connections: z.array(z.object({ id: z.uuid(), client: z.string() })) }).parse(await res.json());
  expect(JSON.stringify(list)).not.toContain(tokens.access_token);
  const [grant] = await db.select().from(mcpGrants).where(eq(mcpGrants.clientId, client.client_id));
  await db.update(users).set({ blockedAt: new Date() }).where(eq(users.id, own.id));
  expect((await call('/mcp', 'POST', {}, tokens.access_token)).status).toBe(401);
  await db.update(users).set({ blockedAt: null }).where(eq(users.id, own.id));
  await db.update(mcpGrants).set({ createdAt: new Date(0), expiresAt: new Date(1) }).where(eq(mcpGrants.id, grant!.id));
  expect((await call('/mcp', 'POST', {}, tokens.access_token)).status).toBe(401);
  expect((await form('token', { grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.refresh_token })).status).toBe(400);
  await db.update(mcpGrants).set({ createdAt: grant!.createdAt, expiresAt: grant!.expiresAt }).where(eq(mcpGrants.id, grant!.id));
  await db.update(mcpTokens).set({ accessExpiresAt: new Date(0) }).where(eq(mcpTokens.grantId, grant!.id));
  expect((await call('/mcp', 'POST', {}, tokens.access_token)).status).toBe(401);
  expect((await call(`/api/v1/mcp/connections/${grant!.id}`, 'DELETE', undefined, own.token)).status).toBe(200);
  expect((await form('token', { grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.refresh_token })).status).toBe(400);
});

test('confidential clients require their secret even with PKCE; token revocation invalidates access', async () => {
  const client = await register('client_secret_basic');
  const approved = await approval(client.client_id);
  const body = { grant_type: 'authorization_code', client_id: client.client_id, redirect_uri: approved.request.redirect_uri,
    code: approved.code, code_verifier: approved.verifier };
  expect((await form('token', body)).status).toBe(400);
  const authorization = `Basic ${Buffer.from(`${client.client_id}:${client.client_secret}`).toString('base64')}`;
  const res = await form('token', body, authorization);
  expect(res.status).toBe(200);
  const tokens = answer.parse(await res.json());
  expect((await form('revoke', { token: tokens.refresh_token }, authorization)).status).toBe(200);
  expect((await call('/mcp', 'POST', {}, tokens.access_token)).status).toBe(401);
});
