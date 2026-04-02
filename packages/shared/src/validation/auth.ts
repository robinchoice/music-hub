import { z } from 'zod';

export const magicLinkSchema = z.object({
  email: z.string().email(),
});

export const verifyTokenSchema = z.object({
  token: z.string().min(1),
});

export type MagicLinkInput = z.infer<typeof magicLinkSchema>;
export type VerifyTokenInput = z.infer<typeof verifyTokenSchema>;
