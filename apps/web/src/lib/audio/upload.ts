import { SUPPORTED_EXTENSIONS, MAX_FILE_SIZE } from '@music-hub/shared';
import { api } from '$lib/api/client.js';

// Why these files can't go up, or null when they can
export function checkAudioFiles(files: File[]): string | null {
  const tooBig = files.filter((f) => f.size > MAX_FILE_SIZE);
  if (tooBig.length > 0) return `${tooBig.map((f) => f.name).join(', ')} zu groß (max 500 MB)`;
  const unsupported = files.filter(
    (f) => !SUPPORTED_EXTENSIONS.includes(('.' + f.name.split('.').pop()?.toLowerCase()) as any),
  );
  if (unsupported.length > 0) {
    return `${unsupported.map((f) => f.name).join(', ')}: Format nicht unterstützt. Erlaubt: ${SUPPORTED_EXTENSIONS.join(', ')}`;
  }
  return null;
}

// Files that vanished or lost permission since they were picked, before anything goes up
export async function unreadableFiles(files: File[]) {
  const readable = await Promise.all(files.map((f) => f.slice(0, 1).arrayBuffer().then(() => true, () => false)));
  return files.filter((_, i) => !readable[i]);
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
  // Aborting stops the transfer and registers no version
  signal?: AbortSignal;
};

// Upload URL, file straight to S3, then the version. Returns false when aborted before the version exists.
export async function uploadVersion(trackId: string, file: File, opts: VersionUpload = {}) {
  const mimeType = file.type || 'audio/wav';
  const { uploadUrl, fileKey } = await api.post<{ uploadUrl: string; fileKey: string; versionId: string }>(
    `/versions/track/${trackId}/upload-url`,
    { fileName: file.name, mimeType, fileSize: file.size },
  );
  if (opts.signal?.aborted) return false;

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', mimeType);
    xhr.upload.onprogress = (e) => e.lengthComputable && opts.onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload fehlgeschlagen (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Upload fehlgeschlagen. Prüfe deine Verbindung und versuch es noch einmal.'));
    xhr.onabort = () => reject(new Error('Upload abgebrochen'));
    opts.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
  if (opts.signal?.aborted) return false;

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
