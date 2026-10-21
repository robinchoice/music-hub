import { runInBackground } from '../lib/background.js';
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, and, sql } from 'drizzle-orm';
import {
  createProjectSchema,
  updateProjectSchema,
  inviteMemberSchema,
  updateMemberSchema,
  hasPermission,
  memberRoles,
  type ProjectRole,
} from '@music-hub/shared';
import { projects, projectMembers, users, tracks, magicLinks } from '@music-hub/db';
import { requireAuth, generateToken, hashToken } from '../middleware/auth.js';
import { findUserByEmail } from '../lib/users.js';
import { requestsInProject } from '../lib/profiles.js';
import { sendInviteEmail } from '../services/email.js';
import { createDownloadUrl } from '../storage/s3.js';
import { membershipOf } from '../lib/access.js';
import type { AppEnv } from '../types.js';

async function withCoverUrl<T extends { coverImageUrl?: string | null }>(
  obj: T,
): Promise<T & { coverUrl: string | null }> {
  const coverUrl = obj.coverImageUrl ? await createDownloadUrl(obj.coverImageUrl) : null;
  return { ...obj, coverUrl };
}

export const projectRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  // ?archived=1 lists the archived projects instead
  .get('/', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const archived = c.req.query('archived') === '1';

    const memberships = await db
      .select({
        project: projects,
        role: projectMembers.role,
        extraRoles: projectMembers.extraRoles,
        trackCount: sql<number>`(select count(*)::int from ${tracks} where ${tracks.projectId} = ${projects.id} and ${tracks.deletedAt} is null)`,
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(and(eq(projectMembers.userId, userId), eq(projects.isArchived, archived)));

    const enriched = await Promise.all(
      memberships.map(async ({ extraRoles, ...m }) => ({
        ...m,
        roles: memberRoles({ role: m.role, extraRoles }),
        project: await withCoverUrl(m.project),
      })),
    );
    return c.json({ projects: enriched });
  })

  .post('/', zValidator('json', createProjectSchema), async (c) => {
    const input = c.req.valid('json');
    const db = c.get('db');
    const userId = c.get('userId');

    const [project] = await db
      .insert(projects)
      .values({ ...input, createdById: userId })
      .returning();

    await db.insert(projectMembers).values({
      projectId: project.id,
      userId,
      role: 'owner',
      canUpload: true,
      canComment: true,
      canApprove: true,
    });

    return c.json({ project }, 201);
  })

  .get('/:id', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const projectId = c.req.param('id');

    const membership = await membershipOf(db, projectId, userId);

    if (!membership) {
      return c.json({ error: 'Not found' }, 404);
    }

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    return c.json({
      project: await withCoverUrl(project),
      role: membership.role,
      roles: memberRoles(membership),
      requests: await requestsInProject(db, projectId),
    });
  })

  .patch('/:id', zValidator('json', updateProjectSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    const input = c.req.valid('json');

    const membership = await membershipOf(db, projectId, userId);

    if (membership?.role !== 'owner') {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const [project] = await db
      .update(projects)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(projects.id, projectId))
      .returning();

    return c.json({ project: await withCoverUrl(project) });
  })

  .delete('/:id', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const projectId = c.req.param('id');

    const membership = await membershipOf(db, projectId, userId);

    if (membership?.role !== 'owner') {
      return c.json({ error: 'Forbidden' }, 403);
    }

    await db
      .update(projects)
      .set({ isArchived: true, updatedAt: new Date() })
      .where(eq(projects.id, projectId));

    return c.json({ message: 'Project archived' });
  })

  .post('/:id/restore', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const projectId = c.req.param('id');

    const membership = await membershipOf(db, projectId, userId);

    if (membership?.role !== 'owner') {
      return c.json({ error: 'Forbidden' }, 403);
    }

    await db
      .update(projects)
      .set({ isArchived: false, updatedAt: new Date() })
      .where(eq(projects.id, projectId));

    return c.json({ message: 'Project restored' });
  })

  // Members
  .get('/:id/members', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const projectId = c.req.param('id');

    // Check access
    const membership = await membershipOf(db, projectId, userId);

    if (!membership) {
      return c.json({ error: 'Not found' }, 404);
    }

    const members = await db
      .select({
        id: projectMembers.id,
        role: projectMembers.role,
        extraRoles: projectMembers.extraRoles,
        canUpload: projectMembers.canUpload,
        canComment: projectMembers.canComment,
        canApprove: projectMembers.canApprove,
        user: {
          id: users.id,
          email: users.email,
          name: users.name,
          avatarUrl: users.avatarUrl,
        },
      })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, projectId));

    return c.json({ members: members.map(({ extraRoles, ...m }) => ({ ...m, roles: memberRoles({ role: m.role, extraRoles }) })) });
  })

  .post('/:id/members', zValidator('json', inviteMemberSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    const { email, ...input } = c.req.valid('json');

    // Check permission (owner or management)
    const membership = await membershipOf(db, projectId, userId);

    if (!membership || !memberRoles(membership).some((r) => r === 'owner' || r === 'management')) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    // Find or create user
    let invitedUser = await findUserByEmail(db, email);

    if (!invitedUser) {
      [invitedUser] = await db
        .insert(users)
        .values({ email, name: email.split('@')[0] })
        .returning();
    }

    const [member] = await db
      .insert(projectMembers)
      .values({
        projectId,
        userId: invitedUser.id,
        ...roleColumns(input),
      })
      .onConflictDoNothing()
      .returning();

    if (!member) {
      return c.json({ error: 'User already a member' }, 409);
    }

    // Without a password the only way in is a link by mail, so the invite
    // doubles as one. Accounts with a password log in as usual instead of
    // getting a week-long login link.
    let loginToken: string | null = null;
    if (!invitedUser.passwordHash) {
      loginToken = generateToken();
      await db.insert(magicLinks).values({
        email: invitedUser.email,
        token: await hashToken(loginToken),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      });
    }

    const [[project], [inviter]] = await Promise.all([
      db.select({ name: projects.name }).from(projects).where(eq(projects.id, projectId)).limit(1),
      db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1),
    ]);
    runInBackground(sendInviteEmail(invitedUser.email, projectId, project.name, inviter.name, loginToken).catch(
      (err) => console.error('[Email] Invite failed:', err),
    ));

    return c.json({ member }, 201);
  })

  .patch('/:id/members/:memberId', zValidator('json', updateMemberSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    const memberId = c.req.param('memberId');
    const input = c.req.valid('json');

    const membership = await membershipOf(db, projectId, userId);

    if (membership?.role !== 'owner') {
      return c.json({ error: 'Forbidden' }, 403);
    }

    if (memberId === membership.id) {
      return c.json({ error: 'Cannot change own owner role' }, 403);
    }

    const [updated] = await db
      .update(projectMembers)
      .set(roleColumns(input))
      .where(and(eq(projectMembers.id, memberId), eq(projectMembers.projectId, projectId)))
      .returning();

    return c.json({ member: updated });
  })

  .delete('/:id/members/:memberId', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    const memberId = c.req.param('memberId');

    const membership = await membershipOf(db, projectId, userId);

    if (membership?.role !== 'owner') {
      return c.json({ error: 'Forbidden' }, 403);
    }

    if (memberId === membership.id) {
      return c.json({ error: 'Cannot remove own owner membership' }, 403);
    }

    await db.delete(projectMembers).where(and(eq(projectMembers.id, memberId), eq(projectMembers.projectId, projectId)));
    return c.json({ message: 'Member removed' });
  });

// The rights of several roles add up
export function roleColumns(input: { role?: ProjectRole | undefined; roles?: ProjectRole[] | undefined }) {
  const [role, ...extraRoles] = [...new Set(input.roles ?? [input.role!])];
  const all = [role, ...extraRoles];
  return {
    role,
    extraRoles,
    canUpload: all.some((r) => hasPermission(r, 'track.upload')),
    canComment: all.some((r) => hasPermission(r, 'version.comment')),
    canApprove: all.some((r) => hasPermission(r, 'version.approve')),
  };
}
