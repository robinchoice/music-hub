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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Don't intercept API or S3 traffic
  if (url.pathname.startsWith('/api/') || url.hostname !== sw.location.hostname) return;

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
