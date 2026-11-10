import { runInBackground } from '../lib/background.js';
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, and, sql, inArray } from 'drizzle-orm';
import {
  createProjectSchema,
  updateProjectSchema,
  inviteMemberSchema,
  updateMemberSchema,
  memberRoles,
  pickRights,
  rightsOfRoles,
  type MemberRights,
  type ProjectRole,
} from '@music-hub/shared';
import { projects, projectMembers, users, tracks, magicLinks, sessions } from '@music-hub/db';
import { requireAuth, generateToken, hashToken } from '../middleware/auth.js';
import { findUserByEmail, inviteeAccount } from '../lib/users.js';
import { rateLimit, tooManyRequests } from '../lib/rate-limit.js';
import { requestsInProject } from '../lib/profiles.js';
import { sendInviteEmail } from '../services/email.js';
import { createDownloadUrl } from '../storage/s3.js';
import { membershipOf } from '../lib/access.js';
import type { AppEnv } from '../types.js';
import { locale, t } from '../lib/i18n.js';
import { pickLocale } from '@music-hub/shared';

async function withCoverUrl<T extends { coverImageUrl?: string | null }>(
  obj: T,
): Promise<T & { coverUrl: string | null }> {
  const coverUrl = obj.coverImageUrl ? await createDownloadUrl(obj.coverImageUrl) : null;
  return { ...obj, coverUrl };
}

// Invitation mails per person who invites
const invitesPerUser = rateLimit('invites-per-user', 20, 60 * 60 * 1000);

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
        membership: projectMembers,
        trackCount: sql<number>`(select count(*)::int from ${tracks} where ${tracks.projectId} = ${projects.id} and ${tracks.deletedAt} is null)`,
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(and(eq(projectMembers.userId, userId), eq(projects.isArchived, archived)));

    const enriched = await Promise.all(
      memberships.map(async ({ extraRoles, membership, ...m }) => ({
        ...m,
        roles: memberRoles({ role: m.role, extraRoles }),
        rights: pickRights(membership),
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
      ...roleColumns({ roles: ['owner'] }),
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
      // In an archived project uploading, commenting and approving rest (membershipOf)
      rights: pickRights(membership),
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
        canDownload: projectMembers.canDownload,
        canInvite: projectMembers.canInvite,
        user: {
          id: users.id,
          email: users.email,
          name: users.name,
          avatarUrl: users.avatarUrl,
        },
        lastSeenAt: users.lastSeenAt,
      })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, projectId))
      // The owner first, then by name
      .orderBy(sql`${projectMembers.role} = 'owner' desc`, users.name);

    // Invited and never logged in: no session and never seen
    const ids = members.map((m) => m.user.id);
    const loggedIn = new Set(
      ids.length ? (await db.selectDistinct({ userId: sessions.userId }).from(sessions).where(inArray(sessions.userId, ids))).map((s) => s.userId) : [],
    );

    return c.json({
      members: members.map(({ extraRoles, lastSeenAt, ...m }) => ({
        ...m,
        roles: memberRoles({ role: m.role, extraRoles }),
        invitePending: !lastSeenAt && !loggedIn.has(m.user.id),
      })),
    });
  })

  .post('/:id/members', zValidator('json', inviteMemberSchema), async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');
    const projectId = c.req.param('id');
    const { email, ...input } = c.req.valid('json');

    // Inviting is a switch of its own, owner and management have it by default
    const membership = await membershipOf(db, projectId, userId);

    if (!membership?.canInvite) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    // Single rights stay the owner's business, as in PATCH
    if (input.rights && membership.role !== 'owner') {
      return c.json({ error: 'Forbidden' }, 403);
    }

    // Each invitation is a mail and may create an account, so the limit comes first; a blocked account stays out
    if (!(await invitesPerUser.hit(db, userId))) return tooManyRequests(c);
    const invitedUser = (await findUserByEmail(db, email)) ?? (await inviteeAccount(db, email, locale(c)));
    if (invitedUser.blockedAt) return c.json({ error: t(c).errors.cannotInvite }, 403);

    const [member] = await db
      .insert(projectMembers)
      .values({
        projectId,
        userId: invitedUser.id,
        ...withRights(roleColumns(input), input.rights),
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
    runInBackground(sendInviteEmail(invitedUser.email, projectId, project.name, inviter.name, loginToken, pickLocale(invitedUser.locale)).catch(
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

    const [member] = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.id, memberId), eq(projectMembers.projectId, projectId)))
      .limit(1);
    if (!member) return c.json({ error: 'Not found' }, 404);

    // New roles set all switches to their preset, single switches go on top
    const columns = input.role || input.roles ? roleColumns(input) : { role: member.role, extraRoles: member.extraRoles, ...pickRights(member) };
    const [updated] = await db
      .update(projectMembers)
      .set(withRights(columns, input.rights))
      .where(eq(projectMembers.id, memberId))
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

// The rights of several roles add up to the preset of the switches
export function roleColumns(input: { role?: ProjectRole | undefined; roles?: ProjectRole[] | undefined }) {
  const [role, ...extraRoles] = [...new Set(input.roles ?? [input.role!])];
  return { role, extraRoles, ...rightsOfRoles([role, ...extraRoles]) };
}

// Single switches over the preset; an owner keeps every right, so nobody locks the project
function withRights<T extends MemberRights & { role: ProjectRole; extraRoles: ProjectRole[] }>(columns: T, rights: Partial<Record<keyof MemberRights, boolean | undefined>> | undefined): T {
  if (columns.role === 'owner' || columns.extraRoles.includes('owner')) return { ...columns, ...rightsOfRoles(['owner']) };
  const set = Object.fromEntries(Object.entries(rights ?? {}).filter(([, v]) => v !== undefined));
  return { ...columns, ...set };
}
