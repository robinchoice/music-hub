/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// Minimal service worker — primarily exists so the PWA install prompt
// is offered on iOS and Android. We cache the app shell + static assets
// for offline-aware behaviour, but never cache API responses.

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `musichub-${version}`;
const OFFLINE_CACHE = 'musichub-offline-v1';
const ASSETS = [...build, ...files];

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => sw.skipWaiting()),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          // Keep the offline cache across version updates
          keys.filter((k) => k !== CACHE && k !== OFFLINE_CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Don't intercept S3 or other cross-origin traffic
  if (url.hostname !== sw.location.hostname) return;

  // Cache-first from offline cache for proxied audio/waveform endpoints
  const isOfflineAsset =
    /^\/api\/v1\/versions\/[^/]+\/audio/.test(url.pathname) ||
    /^\/api\/v1\/versions\/[^/]+\/waveform-data$/.test(url.pathname);

  if (isOfflineAsset) {
    event.respondWith(
      caches.open(OFFLINE_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        return fetch(req);
      }),
    );
    return;
  }

  // Don't intercept other API traffic
  if (url.pathname.startsWith('/api/')) return;

  // Cache-first for built assets, network-first for everything else
  if (ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => cached ?? fetch(req)),
    );
    return;
  }

  event.respondWith(
    fetch(req).catch(() => caches.match(req).then((c) => c ?? new Response('', { status: 504 }))),
  );
});
