// Service Worker — umožňuje instalaci PWA
const CACHE = 'cv-v1';

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE).then(c => c.addAll([
            '/', '/index.html', '/app.js', '/style.css', '/logo.svg'
        ]))
    );
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ));
    self.clients.claim();
});

self.addEventListener('fetch', e => {
    // Jen GET requesty, API přeskočíme
    if (!e.request.url.includes('/api/')) {
        e.respondWith(
            caches.match(e.request).then(r => r || fetch(e.request))
        );
    }
});