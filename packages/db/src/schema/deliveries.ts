import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, text, integer, bigint, boolean, timestamp, primaryKey, unique, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { projects } from './projects.js';
import { tracks, versions } from './tracks.js';
import { projectShareLinks } from './shareLinks.js';
import { reviews } from './reviews.js';

// A studio's order on its own project link: the client approves each song or asks for a correction
// round, pays the total once everything is approved, and only then downloads the originals.
// Amounts are euro cents. Money goes straight to the studio, never through Music Hub.
export const deliveries = pgTable('deliveries', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectLinkId: uuid('project_link_id')
    .references(() => projectShareLinks.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  projectId: uuid('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull(),
  createdById: uuid('created_by_id')
    .references(() => users.id)
    .notNull(),
  clientName: varchar('client_name', { length: 255 }).notNull(),
  clientEmail: varchar('client_email', { length: 255 }),
  reference: varchar('reference', { length: 64 }),
  includedRounds: integer('included_rounds').default(2).notNull(),
  extraRoundCents: integer('extra_round_cents').default(0).notNull(),
  includeStems: boolean('include_stems').default(true).notNull(),
  // 'open', 'paid' or 'cancelled'
  status: varchar('status', { length: 16 }).default('open').notNull(),
  paidAt: timestamp('paid_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const deliveryTracks = pgTable(
  'delivery_tracks',
  {
    deliveryId: uuid('delivery_id')
      .references(() => deliveries.id, { onDelete: 'cascade' })
      .notNull(),
    trackId: uuid('track_id')
      .references(() => tracks.id, { onDelete: 'cascade' })
      .notNull(),
    priceCents: integer('price_cents').notNull(),
    // Free rounds the studio added on top of deliveries.included_rounds
    giftedRounds: integer('gifted_rounds').default(0).notNull(),
    // The version the client approved; its original is what they download after paying
    approvedVersionId: uuid('approved_version_id').references(() => versions.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at'),
    approvedByName: varchar('approved_by_name', { length: 255 }),
  },
  (t) => [primaryKey({ columns: [t.deliveryId, t.trackId] })],
);

// A correction round: the client asked for changes to the version they heard. One per version,
// so the studio uploads a new version before the next one. extra rounds go onto the bill at the
// price the client confirmed. A round outlives its version: purging the version from the trash
// leaves version_id null, the round still counts and is billed.
export const deliveryRounds = pgTable(
  'delivery_rounds',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    deliveryId: uuid('delivery_id')
      .references(() => deliveries.id, { onDelete: 'cascade' })
      .notNull(),
    trackId: uuid('track_id')
      .references(() => tracks.id, { onDelete: 'cascade' })
      .notNull(),
    versionId: uuid('version_id').references(() => versions.id, { onDelete: 'set null' }),
    versionNumber: integer('version_number').notNull(),
    reviewId: uuid('review_id').references(() => reviews.id, { onDelete: 'set null' }),
    guestName: varchar('guest_name', { length: 255 }),
    extra: boolean('extra').notNull(),
    // What an extra round costs, as the client confirmed it; 0 for included ones
    priceCents: integer('price_cents').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [unique('delivery_rounds_version').on(t.deliveryId, t.trackId, t.versionId)],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    deliveryId: uuid('delivery_id')
      .references(() => deliveries.id, { onDelete: 'cascade' })
      .notNull(),
    // 'lightning' or 'transfer'
    method: varchar('method', { length: 16 }).notNull(),
    amountCents: integer('amount_cents').notNull(),
    sats: bigint('sats', { mode: 'number' }),
    // BOLT11 invoice from the studio's wallet
    invoice: text('invoice'),
    paymentHash: varchar('payment_hash', { length: 64 }),
    // 'pending', 'announced' (client says they transferred), 'paid' or 'expired'
    status: varchar('status', { length: 16 }).default('pending').notNull(),
    expiresAt: timestamp('expires_at'),
    // The studio member who confirmed a transfer; null for Lightning
    confirmedById: uuid('confirmed_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    paidAt: timestamp('paid_at'),
  },
  (t) => [
    index().on(t.deliveryId),
    // At most one open payment per delivery
    uniqueIndex('payments_one_open').on(t.deliveryId).where(sql`status in ('pending', 'announced')`),
  ],
);

// Where a studio receives money: its own Lightning wallet over NWC (receive-only), its own bank account
export const paymentAccounts = pgTable('payment_accounts', {
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .primaryKey(),
  // The NWC connection string, AES-256-GCM with PAYMENT_SECRETS_KEY; never leaves the API
  nwcSecretEnc: text('nwc_secret_enc'),
  nwcAlias: varchar('nwc_alias', { length: 255 }),
  iban: varchar('iban', { length: 34 }),
  bic: varchar('bic', { length: 11 }),
  accountHolder: varchar('account_holder', { length: 70 }),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
