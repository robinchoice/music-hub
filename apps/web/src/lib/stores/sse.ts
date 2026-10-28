import { z } from 'zod';

import { demoMode } from '$lib/demo/mode.js';

const eventData = z.object({ versionId: z.string().optional(), status: z.string().optional(), undone: z.boolean().optional() });

type SseHandler = (event: { type: string; data: z.infer<typeof eventData> }) => void;

let es: EventSource | null = null;
let currentTrackId: string | null = null;
let handler: SseHandler | null = null;

export function connectTrackSse(trackId: string, onEvent: SseHandler): () => void {
  if (demoMode) return () => {};
  if (currentTrackId === trackId && es?.readyState === EventSource.OPEN) {
    handler = onEvent;
    return () => disconnect();
  }

  disconnect();
  currentTrackId = trackId;
  handler = onEvent;

  es = new EventSource(`/api/v1/sse/track/${trackId}`, { withCredentials: true });

  const types = ['version:new', 'version:status', 'version:details', 'comment:new', 'comment:reaction', 'review:new'];
  for (const type of types) {
    es.addEventListener(type, (e: MessageEvent) => {
      try {
        handler?.({ type, data: eventData.parse(JSON.parse(e.data)) });
      } catch { /* ignore malformed */ }
    });
  }

  es.onerror = () => {
    // Browser auto-reconnects EventSource — nothing to do
  };

  return () => disconnect();
}

function disconnect() {
  es?.close();
  es = null;
  currentTrackId = null;
  handler = null;
}
