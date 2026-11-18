import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const mcpClients = pgTable('mcp_clients', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  redirectUris: text('redirect_uris').array().notNull(),
  secretHash: varchar('secret_hash', { length: 128 }),
  authMethod: text('auth_method').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [check('mcp_client_auth_method', sql`${t.authMethod} in ('none', 'client_secret_post', 'client_secret_basic')`)]);

export const mcpGrants = pgTable('mcp_grants', {
  id: uuid('id').defaultRandom().primaryKey(),
  clientId: uuid('client_id').notNull().references(() => mcpClients.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
}, (t) => [check('mcp_grant_lifetime', sql`${t.expiresAt} > ${t.createdAt}`)]);

export const mcpCodes = pgTable('mcp_codes', {
  hash: varchar('hash', { length: 128 }).primaryKey(),
  grantId: uuid('grant_id').notNull().references(() => mcpGrants.id, { onDelete: 'cascade' }),
  redirectUri: text('redirect_uri').notNull(),
  challenge: varchar('challenge', { length: 128 }).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
});

export const mcpTokens = pgTable('mcp_tokens', {
  accessHash: varchar('access_hash', { length: 128 }).primaryKey(),
  refreshHash: varchar('refresh_hash', { length: 128 }).notNull().unique(),
  grantId: uuid('grant_id').notNull().references(() => mcpGrants.id, { onDelete: 'cascade' }),
  accessExpiresAt: timestamp('access_expires_at').notNull(),
  refreshExpiresAt: timestamp('refresh_expires_at').notNull(),
  rotatedAt: timestamp('rotated_at'),
});
