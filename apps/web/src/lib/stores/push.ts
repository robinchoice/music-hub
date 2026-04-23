import { api } from '$lib/api/client.js';

export type PushState = 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed';

let _state = $state<PushState>('unsupported');
let _loading = $state(false);

export const pushStore = {
  get state() { return _state; },
  get loading() { return _loading; },
};

export async function initPush(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (Notification.permission === 'denied') { _state = 'denied'; return; }

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  _state = sub ? 'subscribed' : 'unsubscribed';
}

export async function subscribePush(): Promise<void> {
  if (_loading) return;
  _loading = true;
  try {
    const { key } = await api.get<{ key: string }>('/push/vapid-public-key');
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
    const json = sub.toJSON();
    await api.post('/push/subscribe', {
      endpoint: sub.endpoint,
      keys: { p256dh: json.keys!.p256dh, auth: json.keys!.auth },
      userAgent: navigator.userAgent.slice(0, 200),
    });
    _state = 'subscribed';
  } catch (err: any) {
    if (Notification.permission === 'denied') _state = 'denied';
    console.error('[Push] subscribe error:', err.message);
  } finally {
    _loading = false;
  }
}

export async function unsubscribePush(): Promise<void> {
  if (_loading) return;
  _loading = true;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api.delete('/push/subscribe', { endpoint: sub.endpoint });
      await sub.unsubscribe();
    }
    _state = 'unsubscribed';
  } finally {
    _loading = false;
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
