import { z } from 'zod';
import { PROJECT_ROLES } from '../constants/roles.js';
import { coverKeySchema } from './track.js';

export const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  artist: z.string().max(255).nullable().optional(),
  coverImageUrl: coverKeySchema.nullable().optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  artist: z.string().max(255).nullable().optional(),
  coverImageUrl: coverKeySchema.nullable().optional(),
});

const assignableRole = z.enum(PROJECT_ROLES).refine((r) => r !== 'owner', {
  message: 'Cannot assign owner',
});

// roles replaces role, which older clients still send
const memberRoles = {
  role: assignableRole.optional(),
  roles: z.array(assignableRole).min(1).max(PROJECT_ROLES.length).optional(),
};
const hasRole = (m: { role?: string | undefined; roles?: string[] | undefined }) => !!(m.role || m.roles);

export const inviteMemberSchema = z
  .object({ email: z.string().email(), ...memberRoles })
  .refine(hasRole, { message: 'role or roles required' });

export const updateMemberSchema = z
  .object(memberRoles)
  .refine(hasRole, { message: 'role or roles required' });

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
