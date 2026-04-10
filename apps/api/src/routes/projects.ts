import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, and, sql } from 'drizzle-orm';
import {
  createProjectSchema,
  updateProjectSchema,
  inviteMemberSchema,
  updateMemberSchema,
} from '@music-hub/shared';
import { projects, projectMembers, users, tracks } from '@music-hub/db';
import { requireAuth } from '../middleware/auth.js';
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
        trackCount: sql<number>`(select count(*)::int from ${tracks} where ${tracks.projectId} = ${projects.id})`,
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
    let [invitedUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

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

    const defaults = getRoleDefaults(newRole);
    const [updated] = await db
      .update(projectMembers)
      .set({ role: newRole, ...defaults })
      .where(eq(projectMembers.id, memberId))
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

    await db.delete(projectMembers).where(eq(projectMembers.id, memberId));
    return c.json({ message: 'Member removed' });
  });

function getRoleDefaults(role: string) {
  const engineerRoles = ['recording_engineer', 'mixing_engineer', 'mastering_engineer'];
  if (role === 'owner') return { canUpload: true, canComment: true, canApprove: true };
  if (engineerRoles.includes(role)) return { canUpload: true, canComment: true, canApprove: false };
  if (role === 'artist') return { canUpload: false, canComment: true, canApprove: true };
  if (role === 'label') return { canUpload: false, canComment: true, canApprove: true };
  if (role === 'management') return { canUpload: false, canComment: true, canApprove: true };
  return { canUpload: false, canComment: false, canApprove: false }; // viewer
}
