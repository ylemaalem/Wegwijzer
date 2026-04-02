// =============================================
// WEGWIJZER — Service Worker
// Caching strategie: network-first met cache fallback
// =============================================

var CACHE_NAME = 'wegwijzer-v5';

// Installatie: skip caching static assets (ze worden on-demand gecached)
self.addEventListener('install', function (event) {
  self.skipWaiting();
});

// Activatie: verwijder oude caches
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (cacheNames) {
      return Promise.all(
        cacheNames
          .filter(function (name) { return name !== CACHE_NAME; })
          .map(function (name) { return caches.delete(name); })
      );
    })
  );
  self.clients.claim();
});

// Fetch: network-first, cache als fallback
self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);

  // API calls, Supabase en Google Fonts: altijd netwerk
  if (url.hostname.includes('supabase') || url.hostname.includes('googleapis') || url.hostname.includes('gstatic')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(function (response) {
        if (response.status === 200 && event.request.method === 'GET') {
          var responseClone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(function () {
        return caches.match(event.request).then(function (cached) {
          return cached || new Response('Offline — controleer je internetverbinding', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        });
      })
  );
});
