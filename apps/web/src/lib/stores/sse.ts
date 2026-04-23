type SseHandler = (event: { type: string; data: unknown }) => void;

let es: EventSource | null = null;
let currentTrackId: string | null = null;
let handler: SseHandler | null = null;

export function connectTrackSse(trackId: string, onEvent: SseHandler): () => void {
  if (currentTrackId === trackId && es?.readyState === EventSource.OPEN) {
    handler = onEvent;
    return () => disconnect();
  }

  disconnect();
  currentTrackId = trackId;
  handler = onEvent;

  es = new EventSource(`/api/v1/sse/track/${trackId}`, { withCredentials: true });

  const types = ['version:new', 'version:status', 'comment:new'];
  for (const type of types) {
    es.addEventListener(type, (e: MessageEvent) => {
      try {
        handler?.({ type, data: JSON.parse(e.data) });
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
