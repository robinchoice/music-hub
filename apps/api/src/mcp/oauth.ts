import OAuth2Server from '@node-oauth/oauth2-server';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { mcpClients, mcpCodes, mcpGrants, mcpTokens, users, type Database } from '@music-hub/db';
import { z } from 'zod';
import { generateToken, hashToken } from '../middleware/auth.js';

export const MCP_SCOPE = 'music:read';
export const oauthIssuer = () => new URL(process.env.APP_URL || 'http://localhost:5173').origin;
export const mcpResource = () => `${oauthIssuer()}/mcp`;
const userSchema = z.object({ id: z.uuid(), grantId: z.uuid() });

export function oauthServer(db: Database) {
  const liveGrant = and(gt(mcpGrants.expiresAt, new Date()), isNull(users.blockedAt));
  const clientOf = (c: typeof mcpClients.$inferSelect): OAuth2Server.Client => ({
    id: c.id, redirectUris: c.redirectUris, grants: ['authorization_code', 'refresh_token'],
  });
  const model: OAuth2Server.AuthorizationCodeModel & OAuth2Server.RefreshTokenModel = {
    async getClient(id, secret) {
      if (!z.uuid().safeParse(id).success) return false;
      const [client] = await db.select().from(mcpClients).where(eq(mcpClients.id, id));
      if (!client) return false;
      // authorize() passes null, token() passes undefined when no secret was supplied.
      if (secret !== null && client.secretHash && (!secret || await hashToken(secret) !== client.secretHash)) return false;
      return clientOf(client);
    },
    generateAccessToken: async () => generateToken(),
    generateRefreshToken: async () => generateToken(),
    generateAuthorizationCode: async () => generateToken(),
    async validateScope(_user, _client, scope) {
      return !scope?.length || (scope.length === 1 && scope[0] === MCP_SCOPE) ? [MCP_SCOPE] : false;
    },
    async saveAuthorizationCode(code, client, inputUser) {
      const { id: userId } = z.object({ id: z.uuid() }).parse(inputUser);
      const grantId = await db.transaction(async (tx) => {
        const [grant] = await tx.insert(mcpGrants).values({ clientId: client.id, userId, expiresAt: new Date(Date.now() + 90 * 86_400_000) }).returning();
        await tx.insert(mcpCodes).values({ hash: await hashToken(code.authorizationCode), grantId: grant!.id,
          redirectUri: code.redirectUri, challenge: z.string().parse(code.codeChallenge), expiresAt: code.expiresAt });
        return grant!.id;
      });
      return { ...code, client, user: { id: userId, grantId } };
    },
    async getAuthorizationCode(code) {
      const [row] = await db.select({ code: mcpCodes, grant: mcpGrants, client: mcpClients }).from(mcpCodes)
        .innerJoin(mcpGrants, eq(mcpGrants.id, mcpCodes.grantId))
        .innerJoin(mcpClients, eq(mcpClients.id, mcpGrants.clientId))
        .innerJoin(users, eq(users.id, mcpGrants.userId))
        .where(and(eq(mcpCodes.hash, await hashToken(code)), liveGrant));
      return row ? { authorizationCode: code, expiresAt: row.code.expiresAt, redirectUri: row.code.redirectUri,
        codeChallenge: row.code.challenge, codeChallengeMethod: 'S256', scope: [MCP_SCOPE],
        client: clientOf(row.client), user: { id: row.grant.userId, grantId: row.grant.id } } : false;
    },
    async revokeAuthorizationCode(code) {
      const rows = await db.delete(mcpCodes).where(eq(mcpCodes.hash, await hashToken(code.authorizationCode))).returning();
      return rows.length === 1;
    },
    async saveToken(token, client, inputUser) {
      const user = userSchema.parse(inputUser);
      const complete = z.object({ accessToken: z.string(), accessTokenExpiresAt: z.date(), refreshToken: z.string(), refreshTokenExpiresAt: z.date() }).parse(token);
      await db.insert(mcpTokens).values({ accessHash: await hashToken(complete.accessToken), refreshHash: await hashToken(complete.refreshToken),
        grantId: user.grantId, accessExpiresAt: complete.accessTokenExpiresAt, refreshExpiresAt: complete.refreshTokenExpiresAt });
      return { ...complete, scope: [MCP_SCOPE], client, user };
    },
    async getAccessToken(accessToken) {
      const [row] = await db.select({ token: mcpTokens, grant: mcpGrants, client: mcpClients }).from(mcpTokens)
        .innerJoin(mcpGrants, eq(mcpGrants.id, mcpTokens.grantId))
        .innerJoin(mcpClients, eq(mcpClients.id, mcpGrants.clientId))
        .innerJoin(users, eq(users.id, mcpGrants.userId))
        .where(and(eq(mcpTokens.accessHash, await hashToken(accessToken)), liveGrant));
      return row ? { accessToken, accessTokenExpiresAt: row.token.accessExpiresAt, scope: [MCP_SCOPE],
        client: clientOf(row.client), user: { id: row.grant.userId, grantId: row.grant.id } } : false;
    },
    async getRefreshToken(refreshToken) {
      const [row] = await db.select({ token: mcpTokens, grant: mcpGrants, client: mcpClients }).from(mcpTokens)
        .innerJoin(mcpGrants, eq(mcpGrants.id, mcpTokens.grantId))
        .innerJoin(mcpClients, eq(mcpClients.id, mcpGrants.clientId))
        .innerJoin(users, eq(users.id, mcpGrants.userId))
        .where(and(eq(mcpTokens.refreshHash, await hashToken(refreshToken)), liveGrant));
      if (!row) return false;
      if (row.token.rotatedAt) {
        await db.delete(mcpGrants).where(eq(mcpGrants.id, row.grant.id));
        return false;
      }
      return { refreshToken, refreshTokenExpiresAt: row.token.refreshExpiresAt, scope: [MCP_SCOPE],
        client: clientOf(row.client), user: { id: row.grant.userId, grantId: row.grant.id } };
    },
    async revokeToken(token) {
      const rows = await db.update(mcpTokens).set({ rotatedAt: new Date() })
        .where(and(eq(mcpTokens.refreshHash, await hashToken(token.refreshToken)), isNull(mcpTokens.rotatedAt))).returning();
      return rows.length === 1;
    },
    verifyScope: async (token, scope) => scope.every((s) => token.scope?.includes(s)),
  };
  return new OAuth2Server({ model, requirePKCE: true, authorizationCodeLifetime: 300, accessTokenLifetime: 3600,
    refreshTokenLifetime: 30 * 86_400, alwaysIssueNewRefreshToken: true,
    requireClientAuthentication: { authorization_code: false, refresh_token: false } });
}

export async function revokeMcpToken(db: Database, token: string, clientId: string) {
  const hash = await hashToken(token);
  const matches = await db.select({ id: mcpGrants.id }).from(mcpGrants)
    .innerJoin(mcpTokens, eq(mcpTokens.grantId, mcpGrants.id))
    .where(and(eq(mcpGrants.clientId, clientId), or(eq(mcpTokens.accessHash, hash), eq(mcpTokens.refreshHash, hash))));
  for (const row of matches) await db.delete(mcpGrants).where(eq(mcpGrants.id, row.id));
}
