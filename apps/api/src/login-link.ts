// Prints a one-time login link, valid like a mailed one for 15 minutes, so an
// agent can log the Savor preview into the live app without the mail. Needs
// DATABASE_URL and APP_URL, so it runs in the api container:
//   bun apps/api/src/login-link.ts <email>
import { createDb, magicLinks } from '@music-hub/db';
import { magicLinkSchema } from '@music-hub/shared';
import { generateToken, hashToken } from './middleware/auth.js';

const { email } = magicLinkSchema.parse({ email: process.argv[2] });
const db = createDb(process.env.DATABASE_URL!);
const token = generateToken();
await db
  .insert(magicLinks)
  .values({ email, token: await hashToken(token), expiresAt: new Date(Date.now() + 15 * 60 * 1000) });
await db.$client.end();
console.log(`${process.env.APP_URL}/auth/verify?token=${token}`);
