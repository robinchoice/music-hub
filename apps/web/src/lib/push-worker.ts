import { openDB } from 'idb';

type Notice = { id: string; title: string; body: string; url: string };
type Cursor = { userId: string; cursor: string };
const neutral = { title: 'Music Hub', body: 'Öffne Music Hub, um Neuigkeiten zu sehen.', url: '/for-you' };

async function openPushDb() {
  const db = await openDB('musichub-push', 1, { upgrade(db) {
    db.createObjectStore('cursor');
    db.createObjectStore('seen').createIndex('time', 'time');
  } });
  const cleanup = db.transaction('seen', 'readwrite');
  for await (const cursor of cleanup.store.index('time').iterate(IDBKeyRange.upperBound(Date.now() - 7 * 86400_000))) {
    await cursor.delete();
  }
  await cleanup.done;
  return db;
}

async function fetchDetails(path: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`/api/v1/push/notifications${path}`, {
      credentials: 'include', cache: 'no-store', signal: controller.signal,
    });
    if (!response.ok) throw new Error('Notification unavailable');
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function show(registration: ServiceWorkerRegistration, notice: typeof neutral, tag: string) {
  return registration.showNotification(notice.title, {
    body: notice.body, tag, icon: '/icons/icon-192.png', badge: '/icons/badge-72.png',
    data: { url: notice.url },
  });
}

export async function showPush(registration: ServiceWorkerRegistration, signal: unknown) {
  const id = signal && typeof signal === 'object' && 'type' in signal && signal.type === 'notification'
    && 'id' in signal && typeof signal.id === 'string' && /^\d{1,19}$/.test(signal.id) ? signal.id : null;
  let notice = neutral;
  let resolved = false;
  if (id) {
    try {
      notice = (await fetchDetails(`/${id}`)).notification;
      resolved = true;
    } catch { /* Always show a visible notification, including when logged out or offline. */ }
  }
  await show(registration, notice, id ? `notification-${id}` : 'musichub');
  if (resolved) {
    try {
      const db = await openPushDb();
      try { await db.put('seen', { time: Date.now() }, id!); } finally { db.close(); }
    } catch { /* Storage failure must not prevent a visible push. */ }
  }
}

let syncing: Promise<void> | undefined;
export function syncPush(registration: ServiceWorkerRegistration) {
  if (syncing) return syncing;
  syncing = catchUp(registration).catch(() => {}).finally(() => { syncing = undefined; });
  return syncing;
}

async function catchUp(registration: ServiceWorkerRegistration) {
  if (Notification.permission !== 'granted' || !await registration.pushManager.getSubscription()) return;
  const db = await openPushDb();
  try {
    let state: Cursor | undefined = await db.get('cursor', 'current');
    // Bound each wake-up; the next foreground poll continues larger backlogs.
    for (let page = 0; page < 5; page++) {
      const result: { userId: string; notifications: Notice[]; cursor: string; more: boolean } =
        await fetchDetails(`?account=${encodeURIComponent(state?.userId ?? '')}&since=${state?.cursor ?? '0'}`);
      for (const notice of result.notifications) {
        if (!await db.get('seen', notice.id)) {
          await show(registration, notice, `notification-${notice.id}`);
          await db.put('seen', { time: Date.now() }, notice.id);
        }
      }
      state = { userId: result.userId, cursor: result.cursor };
      await db.put('cursor', state, 'current');
      if (!result.more) break;
    }
  } finally { db.close(); }
}
