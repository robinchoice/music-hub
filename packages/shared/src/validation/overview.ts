import { z } from 'zod';

export const taskKeySchema = z.object({
  taskKey: z.string().min(1).max(200),
});

export type TaskKeyInput = z.infer<typeof taskKeySchema>;
