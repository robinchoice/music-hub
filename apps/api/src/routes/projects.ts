import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, and, sql } from 'drizzle-orm';
import {
  createProjectSchema,
  updateProjectSchema,
  inviteMemberSchema,
  updateMemberSchema,
  hasPermission,
  type ProjectRole,
} from '@music-hub/shared';
import { projects, projectMembers, users, tracks, magicLinks } from '@music-hub/db';
import { requireAuth, generateToken, hashToken } from '../middleware/auth.js';
import { findUserByEmail } from '../lib/users.js';
import { sendInviteEmail } from '../services/email.js';
import { createDownloadUrl } from '../storage/s3.js';
import type { AppEnv } from '../types.js';

async function withCoverUrl<T extends { coverImageUrl?: string | null }>(
  obj: T,
): Promise<T & { coverUrl: string | null }> {
  const coverUrl = obj.coverImageUrl ? await createDownloadUrl(obj.coverImageUrl) : null;
  return { ...obj, coverUrl };
}

export const projectRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');

    const memberships = await db
      .select({
        project: projects,
        role: projectMembers.role,
        trackCount: sql<number>`(select count(*)::int from ${tracks} where ${tracks.projectId} = ${projects.id} and ${tracks.deletedAt} is null)`,
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(and(eq(projectMembers.userId, userId), eq(projects.isArchived, false)));

    const enriched = await Promise.all(
      memberships.map(async (m) => ({
        ...m,
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

    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .limit(1);

    if (!membership) {
      return c.json({ error: 'Not found' }, 404);
    }

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    return c.json({ project: await withCoverUrl(project), role: membership.role });
  })

  .patch('/:id', zValidator('json', updateProjectSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    const input = c.req.valid('json');

    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId),
          eq(projectMembers.role, 'owner'),
        ),
      )
      .limit(1);

    if (!membership) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const [project] = await db
      .update(projects)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(projects.id, projectId))
      .returning();

    return c.json({ project });
  })

  .delete('/:id', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const projectId = c.req.param('id');

    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId),
          eq(projectMembers.role, 'owner'),
        ),
      )
      .limit(1);

    if (!membership) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    await db
      .update(projects)
      .set({ isArchived: true, updatedAt: new Date() })
      .where(eq(projects.id, projectId));

    return c.json({ message: 'Project archived' });
  })

  // Members
  .get('/:id/members', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const projectId = c.req.param('id');

    // Check access
    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .limit(1);

    if (!membership) {
      return c.json({ error: 'Not found' }, 404);
    }

    const members = await db
      .select({
        id: projectMembers.id,
        role: projectMembers.role,
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

    return c.json({ members });
  })

  .post('/:id/members', zValidator('json', inviteMemberSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    const { email, role } = c.req.valid('json');

    // Check permission (owner or management)
    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .limit(1);

    if (!membership || (membership.role !== 'owner' && membership.role !== 'management')) {
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

    const defaults = getRoleDefaults(role);
    const [member] = await db
      .insert(projectMembers)
      .values({
        projectId,
        userId: invitedUser.id,
        role,
        ...defaults,
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
    sendInviteEmail(invitedUser.email, projectId, project.name, inviter.name, loginToken).catch(
      (err) => console.error('[Email] Invite failed:', err),
    );

    return c.json({ member }, 201);
  })

  .patch('/:id/members/:memberId', zValidator('json', updateMemberSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    const memberId = c.req.param('memberId');
    const { role: newRole } = c.req.valid('json');

    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId),
          eq(projectMembers.role, 'owner'),
        ),
      )
      .limit(1);

    if (!membership) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    if (memberId === membership.id) {
      return c.json({ error: 'Cannot change own owner role' }, 403);
    }

    const defaults = getRoleDefaults(newRole);
    const [updated] = await db
      .update(projectMembers)
      .set({ role: newRole, ...defaults })
      .where(and(eq(projectMembers.id, memberId), eq(projectMembers.projectId, projectId)))
      .returning();

    return c.json({ member: updated });
  })

  .delete('/:id/members/:memberId', async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    const memberId = c.req.param('memberId');

    const [membership] = await db
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId),
          eq(projectMembers.role, 'owner'),
        ),
      )
      .limit(1);

    if (!membership) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    if (memberId === membership.id) {
      return c.json({ error: 'Cannot remove own owner membership' }, 403);
    }

    await db.delete(projectMembers).where(and(eq(projectMembers.id, memberId), eq(projectMembers.projectId, projectId)));
    return c.json({ message: 'Member removed' });
  });

function getRoleDefaults(role: ProjectRole) {
  return {
    canUpload: hasPermission(role, 'track.upload'),
    canComment: hasPermission(role, 'version.comment'),
    canApprove: hasPermission(role, 'version.approve'),
  };
}
