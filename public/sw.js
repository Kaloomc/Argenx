// Réseau d'abord, copie en cache en secours : le dernier tableau affiché reste lisible sans réseau.
// Changer CACHE (argenx-v3…) à chaque nouvelle icône ou refonte : les anciennes copies sont supprimées à l'activation.
const CACHE = 'argenx-v3';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((noms) => Promise.all(noms.filter((n) => n !== CACHE).map((n) => caches.delete(n)))).then(() => self.clients.claim())
));

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copie = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copie));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
