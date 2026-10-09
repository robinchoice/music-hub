import { z } from 'zod';
import { OPEN_LICENSES } from '../constants/open.js';

export const openTrackSchema = z.object({
  license: z.enum(OPEN_LICENSES),
  // The person opening it confirms there are no samples of others in it
  confirmRights: z.literal(true),
});

export const forkTrackSchema = z.object({
  projectId: z.string().uuid(),
});

export const reportOpenTrackSchema = z.object({
  reason: z.string().min(1).max(2000),
  email: z.string().email().max(255).optional(),
});
