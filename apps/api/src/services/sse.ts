import type { Database } from '@music-hub/db';

// Events travel through Postgres NOTIFY, so they reach the clients of every API
// instance, also when the worker sends them. Payloads hold IDs only and stay
// far below the 8000-byte limit of NOTIFY.
const CHANNEL = 'track_events';

type SseClient = (data: string) => void;
type TrackEvent = { trackId: string; type: string; data: unknown };

const channels = new Map<string, Set<SseClient>>();

// Each API instance listens on its own connection, postgres-js reconnects it when it drops
export async function listenForEvents(db: Database) {
  await db.$client.listen(CHANNEL, (payload) => {
    const { trackId, type, data } = JSON.parse(payload) as TrackEvent;
    const clients = channels.get(trackId);
    if (!clients) return;
    const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const send of clients) {
      try { send(msg); } catch { /* client gone */ }
    }
  });
}

export function subscribe(trackId: string, send: SseClient): () => void {
  if (!channels.has(trackId)) channels.set(trackId, new Set());
  channels.get(trackId)!.add(send);
  return () => {
    channels.get(trackId)?.delete(send);
    if (channels.get(trackId)?.size === 0) channels.delete(trackId);
  };
}

export function publish(db: Database, trackId: string, event: { type: string; data: unknown }) {
  db.$client
    .notify(CHANNEL, JSON.stringify({ trackId, ...event } satisfies TrackEvent))
    .catch((err) => console.error('[SSE] Publish failed:', err));
}
