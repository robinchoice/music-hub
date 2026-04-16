import {
  getAllOfflineVersions,
  getOfflineVersion,
  saveOfflineVersion,
  deleteOfflineVersion,
  type OfflineVersionRecord,
  type OfflineQuality,
} from '$lib/offline/db.js';

export type { OfflineVersionRecord, OfflineQuality };

const OFFLINE_CACHE = 'musichub-offline-v1';

// Reactive state
let _versions = $state<OfflineVersionRecord[]>([]);

export const offlineVersions = {
  get value() {
    return _versions;
  },
};

export async function initOfflineStore() {
  _versions = await getAllOfflineVersions();
}

export function isOffline(versionId: string): boolean {
  return _versions.some((v) => v.versionId === versionId);
}

export async function downloadForOffline(
  versionId: string,
  quality: OfflineQuality,
  meta: { trackId: string; projectId: string; title: string; versionNumber: number },
  onProgress?: (pct: number) => void,
): Promise<void> {
  const audioUrl = `/api/v1/versions/${versionId}/audio?quality=${quality}`;
  const waveformUrl = `/api/v1/versions/${versionId}/waveform-data`;

  const cache = await caches.open(OFFLINE_CACHE);

  // Download audio with progress tracking
  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) throw new Error(`Audio-Download fehlgeschlagen: ${audioRes.status}`);

  const contentLength = Number(audioRes.headers.get('Content-Length') ?? '0');
  let loaded = 0;
  const reader = audioRes.body!.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    if (contentLength > 0 && onProgress) {
      onProgress(Math.min(99, Math.round((loaded / contentLength) * 100)));
    }
  }

  const audioBuffer = new Uint8Array(chunks.reduce((acc, c) => acc + c.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    audioBuffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const audioBlob = new Blob([audioBuffer], {
    type: audioRes.headers.get('Content-Type') ?? 'audio/mpeg',
  });

  await cache.put(
    new Request(audioUrl),
    new Response(audioBlob, {
      headers: {
        'Content-Type': audioBlob.type,
        'Content-Length': String(audioBlob.size),
        'Cache-Control': 'private, max-age=3600',
      },
    }),
  );

  // Download waveform (smaller, no progress needed)
  try {
    const waveformRes = await fetch(waveformUrl);
    if (waveformRes.ok) {
      await cache.put(new Request(waveformUrl), waveformRes.clone());
    }
  } catch {
    // Waveform is optional — player falls back to native rendering
  }

  const record: OfflineVersionRecord = {
    versionId,
    trackId: meta.trackId,
    projectId: meta.projectId,
    title: meta.title,
    versionNumber: meta.versionNumber,
    downloadedAt: Date.now(),
    sizeBytes: audioBlob.size,
    mimeType: audioBlob.type,
    quality,
  };

  await saveOfflineVersion(record);
  _versions = await getAllOfflineVersions();

  if (onProgress) onProgress(100);
}

export async function removeOffline(versionId: string): Promise<void> {
  const cache = await caches.open(OFFLINE_CACHE);
  for (const quality of ['stream', 'original'] as const) {
    await cache.delete(new Request(`/api/v1/versions/${versionId}/audio?quality=${quality}`));
  }
  await cache.delete(new Request(`/api/v1/versions/${versionId}/waveform-data`));
  await deleteOfflineVersion(versionId);
  _versions = await getAllOfflineVersions();
}

export async function getOfflineAudioUrl(versionId: string): Promise<string | null> {
  const record = await getOfflineVersion(versionId);
  if (!record) return null;

  const cache = await caches.open(OFFLINE_CACHE);
  const response = await cache.match(
    new Request(`/api/v1/versions/${versionId}/audio?quality=${record.quality}`),
  );
  if (!response) return null;

  const blob = await response.blob();
  return URL.createObjectURL(blob);
}
