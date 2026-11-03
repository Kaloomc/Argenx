// Réseau d'abord, copie en cache en secours : le dernier tableau affiché reste lisible sans réseau.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copie = res.clone();
          caches.open('argenx').then((c) => c.put(e.request, copie));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
