import { eq } from 'drizzle-orm';
import { users, type Database } from '@music-hub/db';
import { activePlan, type PublicStudio, type StudioBrand } from '@music-hub/shared';
import { isAdminEmail } from './admin.js';
import { createDownloadUrl } from '../storage/s3.js';

// The studio brand: name, line and logo an account shows on the guest page of its deliveries. It shows only
// while the account has the plan Studio or is an admin, the same rule as for making deliveries; without it the
// page names the account as before.

type Reader = Pick<Database, 'select'>;

const LOGO_TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const;

// The bucket answers with the type the key's extension stands for, never the one the uploading client sent
function logoUrl(key: string) {
  const ext = key.slice(key.lastIndexOf('.') + 1);
  const type = ext in LOGO_TYPES ? LOGO_TYPES[ext as keyof typeof LOGO_TYPES] : 'application/octet-stream';
  return createDownloadUrl(key, 3600, undefined, type);
}

async function brandRow(db: Reader, userId: string) {
  const [row] = await db
    .select({
      email: users.email,
      accountName: users.name,
      plan: users.plan,
      planUntil: users.planUntil,
      name: users.studioName,
      line: users.studioLine,
      logoKey: users.studioLogoKey,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return undefined;
  const allowed = activePlan(row) === 'solo' || isAdminEmail(row.email);
  return { ...row, allowed, shown: allowed && !!(row.name || row.line || row.logoKey) };
}

export async function studioBrandOf(db: Reader, userId: string): Promise<StudioBrand> {
  const row = await brandRow(db, userId);
  return {
    name: row?.name ?? null,
    line: row?.line ?? null,
    logoKey: row?.logoKey ?? null,
    logoUrl: row?.logoKey ? await logoUrl(row.logoKey) : null,
    shown: !!row?.shown,
    allowed: !!row?.allowed,
  };
}

// What the guest page of a delivery shows of its studio: only name, line and logo, null while the brand doesn't show
export async function publicStudioOf(db: Reader, userId: string): Promise<{ accountName: string; studio: PublicStudio | null }> {
  const row = await brandRow(db, userId);
  if (!row) return { accountName: 'Studio', studio: null };
  if (!row.shown) return { accountName: row.accountName, studio: null };
  return {
    accountName: row.accountName,
    studio: { name: row.name ?? row.accountName, line: row.line, logoUrl: row.logoKey ? await logoUrl(row.logoKey) : null },
  };
}
