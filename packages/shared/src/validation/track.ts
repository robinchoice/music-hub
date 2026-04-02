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
});

export type CreateTrackInput = z.infer<typeof createTrackSchema>;
export type UpdateTrackInput = z.infer<typeof updateTrackSchema>;
export type RequestUploadUrlInput = z.infer<typeof requestUploadUrlSchema>;
export type CreateVersionInput = z.infer<typeof createVersionSchema>;
