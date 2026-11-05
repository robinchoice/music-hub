import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { dropboxConnections, type Database } from '@music-hub/db';
import { decryptSecret, encryptSecret } from './payments/secrets.js';

// Reading someone's Dropbox for the import: OAuth with PKCE (the app key is public, there is no app
// secret to keep), only the scopes to list and download files. The URLs can be pointed at a fake
// Dropbox for the tests.
const authUrl = () => process.env.DROPBOX_AUTH_URL || 'https://www.dropbox.com';
const apiUrl = () => process.env.DROPBOX_API_URL || 'https://api.dropboxapi.com';
const contentUrl = () => process.env.DROPBOX_CONTENT_URL || 'https://content.dropboxapi.com';
const appKey = () => process.env.DROPBOX_APP_KEY ?? '';

export const SCOPES = 'account_info.read files.metadata.read files.content.read';
// A folder with more files than this is too big to look at in one go; pick a folder further down
export const MAX_SCAN_FILES = 20_000;

export const dropboxConfigured = () => Boolean(process.env.DROPBOX_APP_KEY && process.env.DROPBOX_TOKEN_KEY);
export const redirectUri = () => `${process.env.APP_URL || 'http://localhost:5173'}/api/v1/dropbox/callback`;

export class DropboxError extends Error {
  constructor(readonly status: number, readonly summary: string) {
    super(`Dropbox ${status}: ${summary}`);
  }
  // The file is gone or was changed: trying again does not help
  get gone() {
    return this.status === 409 && /not_found|restricted|unsupported_file/.test(this.summary);
  }
  // The connection was revoked in Dropbox
  get unauthorized() {
    return this.status === 401 || /invalid_grant/.test(this.summary);
  }
}

async function failed(res: Response): Promise<never> {
  const body = await res.text().catch(() => '');
  // error_summary names the problem without any of the user's data, e.g. "path/not_found/.."
  const summary = /"error_summary"\s*:\s*"([^"]*)"/.exec(body)?.[1] ?? /"error"\s*:\s*"([^"]*)"/.exec(body)?.[1] ?? res.statusText;
  throw new DropboxError(res.status, summary);
}

export function authorizeUrl(state: string, challenge: string) {
  const params = new URLSearchParams({
    client_id: appKey(),
    response_type: 'code',
    redirect_uri: redirectUri(),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    token_access_type: 'offline',
    scope: SCOPES,
  });
  return `${authUrl()}/oauth2/authorize?${params}`;
}

export function pkcePair() {
  const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const challenge = new Bun.CryptoHasher('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

const tokenAnswer = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().exactOptional(),
  account_id: z.string().exactOptional(),
});

async function token(params: Record<string, string>) {
  const res = await fetch(`${apiUrl()}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: appKey(), ...params }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return failed(res);
  return tokenAnswer.parse(await res.json());
}

const accountAnswer = z.object({
  name: z.object({ display_name: z.string() }).exactOptional(),
  root_info: z.object({ root_namespace_id: z.string(), home_namespace_id: z.string() }).exactOptional(),
});

// Exchanges the code from the redirect and keeps the connection, replacing an earlier one
export async function connect(db: Database, userId: string, code: string, verifier: string) {
  const answer = await token({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri() });
  if (!answer.refresh_token || !answer.account_id) throw new DropboxError(400, 'no_refresh_token');
  const account = accountAnswer.parse(await rpc({ accessToken: answer.access_token, rootNamespaceId: null }, '/2/users/get_current_account', null));
  const root = account.root_info;
  const values = {
    accountId: answer.account_id,
    displayName: account.name?.display_name.slice(0, 255) ?? null,
    rootNamespaceId: root && root.root_namespace_id !== root.home_namespace_id ? root.root_namespace_id : null,
    refreshTokenEnc: encryptSecret(answer.refresh_token, 'DROPBOX_TOKEN_KEY'),
  };
  await db.insert(dropboxConnections).values({ userId, ...values })
    .onConflictDoUpdate({ target: dropboxConnections.userId, set: { ...values, createdAt: new Date() } });
}

export type Session = { accessToken: string; rootNamespaceId: string | null };

// Access tokens live four hours; the worker reuses one for many files instead of asking Dropbox each time.
// Only a cache: a fresh process or another instance just asks again. Keyed by the stored refresh token,
// so a new connection never gets the old account's token.
const accessTokens = new Map<string, { token: string; until: number }>();

// A short-lived access token for the user's connection, or null without one
export async function session(db: Pick<Database, 'select'>, userId: string): Promise<Session | null> {
  const [row] = await db.select().from(dropboxConnections).where(eq(dropboxConnections.userId, userId)).limit(1);
  if (!row) return null;
  const cached = accessTokens.get(row.refreshTokenEnc);
  if (cached && cached.until > Date.now()) return { accessToken: cached.token, rootNamespaceId: row.rootNamespaceId };
  const answer = await token({ grant_type: 'refresh_token', refresh_token: decryptSecret(row.refreshTokenEnc, 'DROPBOX_TOKEN_KEY') });
  if (accessTokens.size > 1000) accessTokens.clear();
  accessTokens.set(row.refreshTokenEnc, { token: answer.access_token, until: Date.now() + (answer.expires_in - 600) * 1000 });
  return { accessToken: answer.access_token, rootNamespaceId: row.rootNamespaceId };
}

function headers(s: Session): Record<string, string> {
  return {
    Authorization: `Bearer ${s.accessToken}`,
    ...(s.rootNamespaceId && { 'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'root', root: s.rootNamespaceId }) }),
  };
}

async function rpc(s: Session, path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${apiUrl()}${path}`, {
    method: 'POST',
    headers: { ...headers(s), ...(body !== null && { 'Content-Type': 'application/json' }) },
    body: body === null ? null : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return failed(res);
  return res.json();
}

export async function revoke(s: Session) {
  await fetch(`${apiUrl()}/2/auth/token/revoke`, { method: 'POST', headers: headers(s), signal: AbortSignal.timeout(10_000) }).catch(() => {});
}

const entry = z.object({
  '.tag': z.string(),
  name: z.string(),
  path_lower: z.string().exactOptional(),
  path_display: z.string().exactOptional(),
  id: z.string().exactOptional(),
  rev: z.string().exactOptional(),
  size: z.number().exactOptional(),
  server_modified: z.string().exactOptional(),
  client_modified: z.string().exactOptional(),
  content_hash: z.string().exactOptional(),
  is_downloadable: z.boolean().exactOptional(),
});
const page = z.object({ entries: z.array(entry), cursor: z.string(), has_more: z.boolean() });
export type DropboxEntry = z.infer<typeof entry>;

// Everything in a folder, page by page; stops with null after `max` files
export async function listFolder(s: Session, path: string, recursive: boolean, max = MAX_SCAN_FILES): Promise<DropboxEntry[] | null> {
  const all: DropboxEntry[] = [];
  let answer = page.parse(await rpc(s, '/2/files/list_folder', { path, recursive, limit: 2000, include_non_downloadable_files: false }));
  for (;;) {
    all.push(...answer.entries);
    if (all.filter((e) => e['.tag'] === 'file').length > max) return null;
    if (!answer.has_more) return all;
    answer = page.parse(await rpc(s, '/2/files/list_folder/continue', { cursor: answer.cursor }));
  }
}

// The file in exactly the revision the scan saw, as a stream
export async function download(s: Session, rev: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(`${contentUrl()}/2/files/download`, {
    method: 'POST',
    headers: { ...headers(s), 'Dropbox-API-Arg': JSON.stringify({ path: `rev:${rev}` }) },
    signal,
  });
  if (!res.ok) return failed(res);
  return res.body!;
}
