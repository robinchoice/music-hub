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

export const MAX_STORAGE_PER_USER = 20 * 1024 * 1024 * 1024; // 20 GB

// The stem ZIP is written without ZIP64, so its offsets end at 4 GB; 1 MB stays free for headers
export const MAX_ZIP_SIZE = 4 * 1024 * 1024 * 1024 - 1024 * 1024;

export const VERSION_STATUSES = [
  'uploaded',
  'processing',
  'ready',
  'approved',
  'rejected',
] as const;

export type VersionStatus = (typeof VERSION_STATUSES)[number];
