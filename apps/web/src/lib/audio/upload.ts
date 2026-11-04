import { SUPPORTED_EXTENSIONS, AUDIO_MIME_BY_EXTENSION, MAX_FILE_SIZE, STEM_MIME_TYPE, type DroppedFile } from '@music-hub/shared';
import { api } from '$lib/api/client.js';
import { t } from '$lib/i18n/index.js';
import { demoMode } from '$lib/demo/mode.js';

export const MAX_FILE_SIZE_LABEL = `${MAX_FILE_SIZE / 1024 ** 2} MB`;

export function checkFileSize(files: File[]): string | null {
  const tooBig = files.filter((f) => f.size > MAX_FILE_SIZE);
  return tooBig.length > 0 ? t().track.upload.tooBig(tooBig.map((f) => f.name).join(', '), MAX_FILE_SIZE_LABEL) : null;
}

// Why these files can't go up, or null when they can
export function checkAudioFiles(files: File[]): string | null {
  const sizeError = checkFileSize(files);
  if (sizeError) return sizeError;
  const unsupported = files.filter((f) => !SUPPORTED_EXTENSIONS.some((ext) => ext === extension(f.name)));
  if (unsupported.length > 0) {
    return t().track.upload.unsupported(unsupported.map((f) => f.name).join(', '), SUPPORTED_EXTENSIONS.join(', '));
  }
  return null;
}

function extension(fileName: string) {
  return '.' + fileName.split('.').pop()?.toLowerCase();
}

export const isVersionable = (fileName: string) => SUPPORTED_EXTENSIONS.some((ext) => ext === extension(fileName));

// The type the bucket stores; browsers leave it empty for AIFF and many DAW files
export function mimeOf(file: File) {
  const known = AUDIO_MIME_BY_EXTENSION[extension(file.name) as keyof typeof AUDIO_MIME_BY_EXTENSION];
  if (known) return known;
  return /^[\w.+-]+\/[\w.+-]+$/.test(file.type) ? file.type : 'application/octet-stream';
}

const isAudioType = (file: File) => /^(audio|video)\//.test(mimeOf(file));

// WAV and AIFF carry their length in the header; reading it needs a few bytes, and Chrome can't decode AIFF at all
async function headerDuration(file: File): Promise<number | null> {
  const read = async (at: number, length: number) => new DataView(await file.slice(at, at + length).arrayBuffer());
  const head = await read(0, 12);
  if (head.byteLength < 12) return null;
  const tag = (view: DataView, at: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(at + i)));
  const riff = tag(head, 0) === 'RIFF' && tag(head, 8) === 'WAVE';
  const aiff = tag(head, 0) === 'FORM' && ['AIFF', 'AIFC'].includes(tag(head, 8));
  if (!riff && !aiff) return null;
  let at = 12;
  let byteRate = 0;
  for (let i = 0; i < 64 && at + 8 <= file.size; i++) {
    const chunk = await read(at, 8);
    const id = tag(chunk, 0);
    const size = chunk.getUint32(4, riff);
    if (riff && id === 'fmt ') byteRate = (await read(at + 8, 12)).getUint32(8, true);
    if (riff && id === 'data') return byteRate ? size / byteRate : null;
    if (aiff && id === 'COMM') {
      const comm = await read(at + 8, 18);
      const frames = comm.getUint32(2);
      // Sample rate as an 80-bit extended float: sign and exponent, then a 64-bit mantissa
      const exponent = (comm.getUint16(8) & 0x7fff) - 16383;
      const rate = (comm.getUint32(10) * 2 ** 32 + comm.getUint32(14)) * 2 ** (exponent - 63);
      return rate > 0 ? frames / rate : null;
    }
    at += 8 + size + (size % 2);
  }
  return null;
}

// Length in seconds, null when it can't be read. Nothing is uploaded for it.
export async function audioDuration(file: File): Promise<number | null> {
  if (!isAudioType(file)) return null;
  const fromHeader = await headerDuration(file).catch(() => null);
  if (fromHeader !== null) return fromHeader;
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (value: number | null) => {
      clearTimeout(timer);
      audio.removeAttribute('src');
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => done(null), 5000);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration : null);
    audio.onerror = () => done(null);
    audio.src = url;
  });
}

export async function describeDrop(files: File[]): Promise<DroppedFile[]> {
  const durations = await Promise.all(files.map(audioDuration));
  return files.map((f, i) => ({
    name: f.name,
    duration: durations[i],
    audio: isAudioType(f),
    versionable: isVersionable(f.name),
  }));
}

// Files that vanished or lost permission since they were picked, before anything goes up
export async function unreadableFiles(files: File[]) {
  const readable = await Promise.all(files.map((f) => f.slice(0, 1).arrayBuffer().then(() => true, () => false)));
  return files.filter((_, i) => !readable[i]);
}

// In the order people number their files: "Mix 3.wav" before "Mix 3 lauter.wav", "Mix 2" before "Mix 10"
export function byFileName(a: File, b: File) {
  const base = (f: File) => f.name.replace(/\.[^.]+$/, '');
  return base(a).localeCompare(base(b), undefined, { numeric: true });
}

// "Letzte Bahn – Mix 1.wav" → "Letzte Bahn"
export function trackNameFromFile(fileName: string) {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/_+/g, ' ').trim();
  let name = base;
  let prev = '';
  while (name !== prev) {
    prev = name;
    name = name.replace(/[\s\-–—.]*\b((mix|mixdown|master|final|bounce|demo|rough)(\s*\d+)?|v\d+|version\s*\d+)\s*$/i, '').trim();
  }
  return name || base;
}

type VersionUpload = {
  label?: string;
  parentVersionId?: string | null;
  branchLabel?: string | null;
  onProgress?: (percent: number) => void;
  onBytes?: (loaded: number) => void;
  onRegister?: () => void;
  // Aborting stops the transfer and registers no version
  signal?: AbortSignal;
};

export async function uploadAudioFile(uploadPath: string, file: File, opts: VersionUpload = {}) {
  const mimeType = AUDIO_MIME_BY_EXTENSION[extension(file.name) as keyof typeof AUDIO_MIME_BY_EXTENSION];
  const { uploadUrl, fileKey } = await api.post<{ uploadUrl: string; fileKey: string }>(uploadPath,
    { fileName: file.name, mimeType, fileSize: file.size });
  if (opts.signal?.aborted) return null;
  if (demoMode) {
    opts.onProgress?.(100);
    opts.onBytes?.(file.size);
    return fileKey;
  }

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', mimeType);
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      opts.onProgress?.(Math.round((e.loaded / e.total) * 100));
      opts.onBytes?.(e.loaded);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(t().track.upload.failedStatus(xhr.status))));
    xhr.onerror = () => reject(new Error(t().track.upload.connection));
    xhr.onabort = () => reject(new Error(t().track.upload.aborted));
    opts.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
  return opts.signal?.aborted ? null : fileKey;
}

// Into the project's upload space; registering decides afterwards whether it becomes a stem or a file of the project
export async function uploadToProject(projectId: string, file: File, opts: VersionUpload = {}) {
  const mimeType = mimeOf(file);
  const { uploadUrl, fileKey } = await api.post<{ uploadUrl: string; fileKey: string }>(`/files/project/${projectId}/upload-url`,
    { fileName: file.name, mimeType, fileSize: file.size });
  if (opts.signal?.aborted) return null;
  if (demoMode) {
    opts.onBytes?.(file.size);
    return fileKey;
  }
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', mimeType);
    xhr.upload.onprogress = (e) => e.lengthComputable && opts.onBytes?.(e.loaded);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(t().track.upload.failedStatus(xhr.status))));
    xhr.onerror = () => reject(new Error(t().track.upload.connection));
    xhr.onabort = () => reject(new Error(t().track.upload.aborted));
    opts.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
  return opts.signal?.aborted ? null : fileKey;
}

export async function registerVersion(trackId: string, file: File, fileKey: string, opts: VersionUpload = {}) {
  if (opts.signal?.aborted) return false;
  const mimeType = AUDIO_MIME_BY_EXTENSION[extension(file.name) as keyof typeof AUDIO_MIME_BY_EXTENSION];
  opts.onRegister?.();
  await api.post(`/versions/track/${trackId}`, {
    fileKey,
    label: opts.label || undefined,
    originalFileName: file.name,
    mimeType,
    fileSize: file.size,
    parentVersionId: opts.parentVersionId ?? undefined,
    branchLabel: opts.branchLabel ?? undefined,
  });
  return true;
}

export async function uploadVersion(trackId: string, file: File, opts: VersionUpload = {}) {
  const fileKey = await uploadAudioFile(`/versions/track/${trackId}/upload-url`, file, opts);
  return fileKey ? registerVersion(trackId, file, fileKey, opts) : false;
}

// Upload URL, file straight to S3, then the stem gets it as its new file. Returns the updated stem.
export async function replaceStemFile<T>(trackId: string, stemId: string, file: File, onProgress?: (percent: number) => void) {
  const error = checkFileSize([file]) ?? (STEM_MIME_TYPE.test(file.type || 'audio/wav') ? null : t().track.upload.notAudio(file.name));
  if (error) throw new Error(error);
  const mimeType = file.type || 'audio/wav';
  const { uploadUrl, fileKey } = await api.post<{ uploadUrl: string; fileKey: string }>(`/stems/track/${trackId}/upload-url`, {
    fileName: file.name,
    mimeType,
    fileSize: file.size,
  });

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', mimeType);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(t().track.upload.failedStatus(xhr.status))));
    xhr.onerror = () => reject(new Error(t().track.upload.connection));
    xhr.send(file);
  });

  const res = await api.post<{ stem: T }>(`/stems/${stemId}/replace`, { fileKey, originalFileName: file.name, mimeType });
  return res.stem;
}
