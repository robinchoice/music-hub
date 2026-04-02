export const SUPPORTED_AUDIO_FORMATS = [
  'audio/wav',
  'audio/x-wav',
  'audio/mp3',
  'audio/mpeg',
  'audio/flac',
  'audio/x-flac',
  'audio/aiff',
  'audio/x-aiff',
] as const;

export const SUPPORTED_EXTENSIONS = ['.wav', '.mp3', '.flac', '.aiff', '.aif'] as const;

export const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB

export const VERSION_STATUSES = [
  'uploaded',
  'processing',
  'ready',
  'approved',
  'rejected',
] as const;

export type VersionStatus = (typeof VERSION_STATUSES)[number];
