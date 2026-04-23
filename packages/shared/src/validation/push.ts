import { z } from 'zod';

export const subscribePushSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
  userAgent: z.string().optional(),
});

export const updateListenEventSchema = z.object({
  listenerName: z.string().max(255).optional(),
  firstPlay: z.boolean().optional(),
  listenSeconds: z.number().int().min(0).optional(),
  completed: z.boolean().optional(),
});
