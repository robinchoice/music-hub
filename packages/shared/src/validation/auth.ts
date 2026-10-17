import { z } from 'zod';

export const magicLinkSchema = z.object({
  email: z.string().email().max(255),
  // Page to return to after login, see safeNextPath
  next: z.string().max(2000).optional(),
  // The unticked checkbox for update mails. Counts once the link is opened, a double opt-in.
  updates: z.boolean().optional(),
});

// A path on this site to return to after login. Anything that would resolve to
// another origin (//host, /\host, or tabs and newlines that browsers strip) is
// dropped, so a crafted link can't redirect elsewhere.
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value?.startsWith('/')) return null;
  try {
    const url = new URL(value, 'http://localhost');
    return url.origin === 'http://localhost' && !url.pathname.startsWith('//')
      ? url.pathname + url.search + url.hash
      : null;
  } catch {
    return null;
  }
}

export const verifyTokenSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(1).max(200).optional(),
});

export const registerSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().max(255),
  password: z.string().min(8).max(200),
  updates: z.boolean().optional(),
});

export const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(200),
});

export const updateMeSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  versionMails: z.boolean().optional(),
  updates: z.boolean().optional(),
}).refine((input) => input.name !== undefined || input.versionMails !== undefined || input.updates !== undefined, {
  message: 'Name is required',
});

export type MagicLinkInput = z.infer<typeof magicLinkSchema>;
export type VerifyTokenInput = z.infer<typeof verifyTokenSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
