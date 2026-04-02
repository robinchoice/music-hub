import { z } from 'zod';
import { PROJECT_ROLES } from '../constants/roles.js';

export const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
});

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(PROJECT_ROLES).refine((r) => r !== 'owner', {
    message: 'Cannot invite as owner',
  }),
});

export const updateMemberSchema = z.object({
  role: z.enum(PROJECT_ROLES).refine((r) => r !== 'owner', {
    message: 'Cannot change role to owner',
  }),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
