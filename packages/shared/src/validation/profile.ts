import { z } from 'zod';

// Who may send a contact request: everyone with an account, people with an open track of their own, nobody
export const REQUESTS_FROM = ['everyone', 'open', 'nobody'] as const;
export type RequestsFrom = (typeof REQUESTS_FROM)[number];

// The part after the @ in /@handle
export const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{1,29}$/;
export const MAX_REQUEST_LENGTH = 500;

export const updateProfileSchema = z.object({
  handle: z.string().regex(HANDLE_PATTERN),
  visible: z.boolean(),
  bio: z.string().trim().max(200).nullable(),
  links: z.array(z.string().url().max(300).refine((u) => /^https?:\/\//.test(u))).max(3),
  requestsFrom: z.enum(REQUESTS_FROM),
  showStats: z.boolean(),
});

export const contactRequestSchema = z.object({
  message: z.string().trim().min(1).max(MAX_REQUEST_LENGTH),
  trackId: z.string().uuid().nullable().optional(),
});

// Without projectId, accepting creates a new project for both
export const acceptRequestSchema = z.object({
  projectId: z.string().uuid().optional(),
});

export const blockRequestSchema = z.object({
  report: z.boolean().default(false),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
