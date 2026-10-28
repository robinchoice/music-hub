import { pgTable, uuid, varchar, text, timestamp, bigint, boolean } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  passwordHash: text('password_hash'),
  avatarUrl: text('avatar_url'),
  // Last visit of the "Tracks" page; marks newer activity as new on every device
  tracksSeenAt: timestamp('tracks_seen_at'),
  // Last authenticated request, written at most every few minutes; the admin pages show who is online
  lastSeenAt: timestamp('last_seen_at'),
  // Set by an admin; a blocked account can't log in and its share links stop working
  blockedAt: timestamp('blocked_at'),
  // Bytes this account may upload; null means MAX_STORAGE_PER_USER
  storageLimit: bigint('storage_limit', { mode: 'number' }),
  // Mails about new versions go to members without push; the token in the mail's unsubscribe link turns them off
  versionMails: boolean('version_mails').default(true).notNull(),
  mailToken: uuid('mail_token').defaultRandom().notNull(),
  // Opt-in for update mails about new features, null = off. The time is the proof of consent.
  // Their unsubscribe link carries mailToken as well.
  updatesConsentAt: timestamp('updates_consent_at'),
  // Whether guests may add files through this account's upload links, and how many bytes; null means GUEST_STORAGE_DEFAULT
  guestUploads: boolean('guest_uploads').default(true).notNull(),
  guestStorageLimit: bigint('guest_storage_limit', { mode: 'number' }),
  // Language of mails and pushes: set at login and by every /auth/me of the web, see apps/api/src/lib/i18n.ts
  locale: varchar('locale', { length: 5 }).default('de').notNull(),
  // null is the free plan, 'pro' or 'solo' (Studio) a paid one, see PLANS in shared. Set by an admin or a payment
  // (lib/billing.ts). A paid plan runs until planUntil, null means open-ended
  plan: varchar('plan', { length: 16 }),
  planUntil: timestamp('plan_until'),
  // The Stripe customer, for the billing portal, and the subscription that renews the plan while it runs
  stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
