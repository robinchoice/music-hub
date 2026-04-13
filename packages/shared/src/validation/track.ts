import { z } from 'zod';
import { SUPPORTED_AUDIO_FORMATS, MAX_FILE_SIZE } from '../constants/audio.js';

export const createTrackSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
});

export const TRACK_STATUSES = ['sketch', 'in_progress', 'final', 'released'] as const;
export type TrackStatus = (typeof TRACK_STATUSES)[number];

export const TRACK_STATUS_LABELS: Record<TrackStatus, string> = {
  sketch: 'Skizze',
  in_progress: 'In Arbeit',
  final: 'Final',
  released: 'Veröffentlicht',
};

export const updateTrackSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  coverImageUrl: z.string().nullable().optional(),
  status: z.enum(TRACK_STATUSES).optional(),
  section: z.string().max(100).nullable().optional(),
});

export const coverUploadSchema = z.object({
  fileName: z.string().min(1).max(200),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  fileSize: z.number().int().positive().max(2 * 1024 * 1024),
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

export const updateVersionSchema = z.object({
  label: z.string().max(100).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  branchLabel: z.string().max(100).nullable().optional(),
});

export const requestStemUploadUrlSchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  fileSize: z.number().int().positive().max(MAX_FILE_SIZE),
});

export const createStemSchema = z.object({
  fileKey: z.string().min(1),
  name: z.string().min(1).max(255),
  originalFileName: z.string().min(1),
  mimeType: z.string().min(1),
  fileSize: z.number().int().positive(),
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
export type UpdateVersionInput = z.infer<typeof updateVersionSchema>;
export type CreateShareLinkInput = z.infer<typeof createShareLinkSchema>;
export type CoverUploadInput = z.infer<typeof coverUploadSchema>;
export type GuestCommentInput = z.infer<typeof guestCommentSchema>;
export type RequestStemUploadUrlInput = z.infer<typeof requestStemUploadUrlSchema>;
export type CreateStemInput = z.infer<typeof createStemSchema>;
