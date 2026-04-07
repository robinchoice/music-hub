import { z } from 'zod';
import { SUPPORTED_AUDIO_FORMATS, MAX_FILE_SIZE } from '../constants/audio.js';

export const createTrackSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
});

export const updateTrackSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
});

export const requestUploadUrlSchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.enum(SUPPORTED_AUDIO_FORMATS),
  fileSize: z.number().int().positive().max(MAX_FILE_SIZE),
});

export const createVersionSchema = z.object({
  fileKey: z.string().min(1),
  label: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
  originalFileName: z.string().min(1),
  mimeType: z.string().min(1),
  fileSize: z.number().int().positive(),
  parentVersionId: z.string().uuid().optional(),
  branchLabel: z.string().max(100).optional(),
});

export const createShareLinkSchema = z.object({
  expiresAt: z.string().datetime().optional(),
  allowComments: z.boolean().optional(),
  allowDownload: z.boolean().optional(),
  password: z.string().min(1).max(255).optional(),
});

export const guestCommentSchema = z.object({
  body: z.string().min(1).max(5000),
  timestampSeconds: z.number().nonnegative().optional(),
  parentId: z.string().uuid().optional(),
  guestName: z.string().min(1).max(100),
});

export type CreateTrackInput = z.infer<typeof createTrackSchema>;
export type UpdateTrackInput = z.infer<typeof updateTrackSchema>;
export type RequestUploadUrlInput = z.infer<typeof requestUploadUrlSchema>;
export type CreateVersionInput = z.infer<typeof createVersionSchema>;
export type CreateShareLinkInput = z.infer<typeof createShareLinkSchema>;
export type GuestCommentInput = z.infer<typeof guestCommentSchema>;
