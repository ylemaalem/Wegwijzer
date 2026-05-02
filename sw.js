// =============================================
// WEGWIJZER — Service Worker
// Caching strategie: network-first met cache fallback
// =============================================

var CACHE_NAME = 'wegwijzer-v8';

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

// Push event: toon notificatie
self.addEventListener('push', function (event) {
  var data = {};
  if (event.data) {
    try { data = event.data.json(); } catch (e) { data = { title: 'Wegwijzer', body: event.data.text() }; }
  }
  var title = data.title || 'Wegwijzer';
  var options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-96.png',
    data: { url: data.url || '/' },
    requireInteraction: false
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Notificationclick: open of focus de juiste tab
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var targetUrl = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windowClients) {
      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i];
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
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
