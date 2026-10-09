import { eq, inArray } from 'drizzle-orm';
import { SIGNUP_STORAGE_PER_USER } from '@music-hub/shared';
import {
  users,
  sessions,
  deviceCodes,
  magicLinks,
  projects,
  projectMembers,
  tracks,
  versions,
  stems,
  pushSubscriptions,
  taskDismissals,
  type Database,
} from '@music-hub/db';
import { generateToken, hashToken } from '../middleware/auth.js';
import { deleteUnusedFiles } from './trash.js';
import { TEST_ACCOUNT_EMAIL } from './users.js';

// Turns the test account back into someone who just signed up: its projects go for good, files included,
// it leaves every other project and forgets everything it saw. Other accounts are never touched.
// Returns a one-time login token for the account.
export async function resetTestAccount(db: Database) {
  const keys = new Set<string>();
  const token = generateToken();

  await db.transaction(async (tx) => {
    let [user] = await tx.select({ id: users.id }).from(users).where(eq(users.email, TEST_ACCOUNT_EMAIL)).limit(1);
    if (!user) {
      [user] = await tx
        .insert(users)
        .values({ email: TEST_ACCOUNT_EMAIL, name: 'Testperson', storageLimit: SIGNUP_STORAGE_PER_USER })
        .returning({ id: users.id });
    }

    const own = await tx
      .select({ id: projects.id, cover: projects.coverImageUrl })
      .from(projects)
      .where(eq(projects.createdById, user.id));
    const projectIds = own.map((p) => p.id);
    own.forEach((p) => p.cover && keys.add(p.cover));
    if (projectIds.length) {
      const trackIds = tx.select({ id: tracks.id }).from(tracks).where(inArray(tracks.projectId, projectIds));
      for (const v of await tx.select().from(versions).where(inArray(versions.trackId, trackIds))) {
        [v.originalFileKey, v.streamFileKey, v.waveformDataKey].forEach((key) => key && keys.add(key));
      }
      for (const s of await tx.select().from(stems).where(inArray(stems.trackId, trackIds))) keys.add(s.fileKey);
      await tx.delete(projects).where(inArray(projects.id, projectIds));
    }

    await tx.delete(projectMembers).where(eq(projectMembers.userId, user.id));
    await tx.delete(taskDismissals).where(eq(taskDismissals.userId, user.id));
    await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, user.id));
    await tx.delete(deviceCodes).where(eq(deviceCodes.userId, user.id));
    await tx.delete(sessions).where(eq(sessions.userId, user.id));
    await tx.delete(magicLinks).where(eq(magicLinks.email, TEST_ACCOUNT_EMAIL));
    await tx
      .update(users)
      .set({
        name: 'Testperson',
        passwordHash: null,
        avatarUrl: null,
        tracksSeenAt: null,
        lastSeenAt: null,
        blockedAt: null,
        storageLimit: SIGNUP_STORAGE_PER_USER,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    await tx.insert(magicLinks).values({
      email: TEST_ACCOUNT_EMAIL,
      token: await hashToken(token),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
  });

  await deleteUnusedFiles(db, keys);
  return token;
}
