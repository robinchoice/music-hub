import { z } from 'zod';

export const deviceStartSchema = z.object({
  client: z.string().trim().min(1).max(100).optional(),
});

export const deviceApproveSchema = z.object({
  userCode: z.string().min(1).max(20),
});

export const deviceTokenSchema = z.object({
  deviceCode: z.string().min(1).max(128),
});
