import { z } from 'zod';
import type { Locale } from '../i18n.js';
import { SUPPORTED_AUDIO_FORMATS, MAX_FILE_SIZE, GUEST_STORAGE_CHOICES } from '../constants/audio.js';

export const createTrackSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
});

export const TRACK_STATUSES = ['sketch', 'in_progress', 'recording', 'mixing', 'mastering', 'final', 'released'] as const;
export type TrackStatus = (typeof TRACK_STATUSES)[number];

// The production stages in their order; in_progress is only kept for tracks that already have it
export const TRACK_STAGES = ['sketch', 'recording', 'mixing', 'mastering', 'final', 'released'] as const satisfies readonly TrackStatus[];

export const TRACK_STATUS_LABELS: Record<Locale, Record<TrackStatus, string>> = {
  de: {
    sketch: 'Demo',
    in_progress: 'In Arbeit',
    recording: 'Recording',
    mixing: 'Mix',
    mastering: 'Master',
    final: 'Final',
    released: 'Veröffentlicht',
  },
  en: {
    sketch: 'Demo',
    in_progress: 'In progress',
    recording: 'Recording',
    mixing: 'Mix',
    mastering: 'Master',
    final: 'Final',
    released: 'Released',
  },
};

export const coverKeySchema = z.string().regex(/^covers\/[0-9a-f-]{36}\.(jpg|png|webp)$/);

export const updateTrackSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  coverImageUrl: coverKeySchema.nullable().optional(),
  status: z.enum(TRACK_STATUSES).optional(),
  section: z.string().max(100).nullable().optional(),
});

export const coverUploadSchema = z.object({
  fileName: z.string().min(1).max(200),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  fileSize: z.number().int().positive().max(2 * 1024 * 1024),
});

export const requestUploadUrlSchema = z.object({
  fileName: z.string().min(1).max(255).regex(/^[^/]+$/),
  mimeType: z.enum(SUPPORTED_AUDIO_FORMATS),
  fileSize: z.number().int().positive().max(MAX_FILE_SIZE),
});

// Hex SHA-256 of the file; the sync app sends it to recognise files it already has
const sha256 = z.string().regex(/^[0-9a-f]{64}$/).optional();

export const createVersionSchema = z.object({
  sha256,
  fileKey: z.string().min(1),
  label: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
  originalFileName: z.string().min(1),
  mimeType: z.string().min(1),
  fileSize: z.number().int().positive(),
  parentVersionId: z.string().uuid().optional(),
  branchLabel: z.string().max(100).optional(),
});

// Key roots as Essentia spells them; the worker stores them in versions.key_root
export const KEY_ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
export const KEY_SCALES = ['major', 'minor'] as const;

export const updateVersionSchema = z.object({
  label: z.string().max(100).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  branchLabel: z.string().max(100).nullable().optional(),
  // Tempo and key corrected by hand, null clears them; root and scale come together
  bpm: z.number().min(20).max(400).nullable().optional(),
  keyRoot: z.enum(KEY_ROOTS).nullable().optional(),
  keyScale: z.enum(KEY_SCALES).nullable().optional(),
}).refine((v) => (v.keyRoot == null) === (v.keyScale == null), { path: ['keyScale'] });

export const rejectVersionSchema = z.object({
  reason: z.string().min(1, 'Begründung erforderlich').max(2000),
});

export const STEM_MIME_TYPE = /^((audio|video)\/[\w.+-]+|application\/(ogg|octet-stream))$/;

export const requestStemUploadUrlSchema = z.object({
  fileName: z.string().min(1).max(255).regex(/^[^/]+$/),
  mimeType: z.string().regex(STEM_MIME_TYPE),
  fileSize: z.number().int().positive().max(MAX_FILE_SIZE),
});

export const createStemSchema = z.object({
  sha256,
  fileKey: z.string().min(1),
  name: z.string().min(1).max(255),
  originalFileName: z.string().min(1),
  mimeType: z.string().regex(STEM_MIME_TYPE),
  fileSize: z.number().int().positive(),
});

export const replaceStemSchema = z.object({
  sha256,
  fileKey: z.string().min(1),
  originalFileName: z.string().min(1),
  mimeType: z.string().regex(STEM_MIME_TYPE),
});

export const SHARE_FOLLOWS = ['version', 'latest', 'approved'] as const;
export type ShareFollows = (typeof SHARE_FOLLOWS)[number];

export const createShareLinkSchema = z.object({
  follows: z.enum(SHARE_FOLLOWS).optional(),
  expiresAt: z.string().datetime().optional(),
  allowComments: z.boolean().optional(),
  allowDownload: z.boolean().optional(),
  password: z.string().min(1).max(255).optional(),
});

// A project link follows every track; 'version' would freeze it on versions picked once
export const PROJECT_SHARE_FOLLOWS = ['latest', 'approved'] as const;

export const createProjectShareLinkSchema = z.object({
  follows: z.enum(PROJECT_SHARE_FOLLOWS).optional(),
  allowComments: z.boolean().optional(),
  allowDownload: z.boolean().optional(),
});

// null clears the password, the expiry or the track selection
export const updateProjectShareLinkSchema = z.object({
  follows: z.enum(PROJECT_SHARE_FOLLOWS).optional(),
  allowComments: z.boolean().optional(),
  allowDownload: z.boolean().optional(),
  password: z.string().min(1).max(255).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  trackIds: z.array(z.string().uuid()).max(500).nullable().optional(),
});

export const guestTrackSchema = z.object({
  name: z.string().trim().min(1).max(255),
});

export const guestStemSchema = createStemSchema.extend({
  guestName: z.string().trim().min(1).max(100),
});

export const guestNoteSchema = z.object({
  guestName: z.string().trim().min(1).max(100),
  body: z.string().trim().min(1).max(2000),
});

export const guestSettingsSchema = z.object({
  allowed: z.boolean().optional(),
  limit: z.number().refine((n) => GUEST_STORAGE_CHOICES.includes(n)).optional(),
});

export const guestCommentSchema = z.object({
  body: z.string().min(1).max(5000),
  timestampSeconds: z.number().nonnegative().optional(),
  parentId: z.string().uuid().optional(),
  guestName: z.string().min(1).max(100),
  // The version the guest listened to; a link that follows the track may show a newer one by now
  versionId: z.string().uuid().optional(),
});

export type CreateTrackInput = z.infer<typeof createTrackSchema>;
export type UpdateTrackInput = z.infer<typeof updateTrackSchema>;
export type RequestUploadUrlInput = z.infer<typeof requestUploadUrlSchema>;
export type CreateVersionInput = z.infer<typeof createVersionSchema>;
export type UpdateVersionInput = z.infer<typeof updateVersionSchema>;
export type CreateShareLinkInput = z.infer<typeof createShareLinkSchema>;
export type UpdateProjectShareLinkInput = z.infer<typeof updateProjectShareLinkSchema>;
export type CoverUploadInput = z.infer<typeof coverUploadSchema>;
export type GuestCommentInput = z.infer<typeof guestCommentSchema>;
export type RequestStemUploadUrlInput = z.infer<typeof requestStemUploadUrlSchema>;
export type CreateStemInput = z.infer<typeof createStemSchema>;
export type ReplaceStemInput = z.infer<typeof replaceStemSchema>;
