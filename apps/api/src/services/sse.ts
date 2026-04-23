type SseClient = (data: string) => void;

const channels = new Map<string, Set<SseClient>>();

export function subscribe(trackId: string, send: SseClient): () => void {
  if (!channels.has(trackId)) channels.set(trackId, new Set());
  channels.get(trackId)!.add(send);
  return () => {
    channels.get(trackId)?.delete(send);
    if (channels.get(trackId)?.size === 0) channels.delete(trackId);
  };
}

export function publish(trackId: string, event: { type: string; data: unknown }) {
  const clients = channels.get(trackId);
  if (!clients || clients.size === 0) return;
  const msg = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
  for (const send of clients) {
    try { send(msg); } catch { /* client gone */ }
  }
}
