import { z } from 'zod';

export const magicLinkSchema = z.object({
  email: z.string().email(),
});

export const verifyTokenSchema = z.object({
  token: z.string().min(1),
});

export const registerSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

export type MagicLinkInput = z.infer<typeof magicLinkSchema>;
export type VerifyTokenInput = z.infer<typeof verifyTokenSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
