const CACHE_NAME = 'pickleball-queue-v7';
const ASSETS = [
    './', './index.html', './styles.css', './app.js', './manifest.json',
    './scoring.html', './scoring.css', './scoring.js', './scoring-engine.js',
    './images/ian.png', './images/ian2.png'
];

self.addEventListener('install', event => {
    // A failed precache must not replace the working offline version.
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(names => Promise.all(
        names.filter(name => name.startsWith('pickleball-queue-') && name !== CACHE_NAME).map(name => caches.delete(name))
    )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
    const navigation = event.request.mode === 'navigate';
    event.respondWith(caches.open(CACHE_NAME).then(async cache => {
        // Match-ID query parameters select stored data, not a different HTML asset.
        const cached = await cache.match(event.request, {ignoreSearch: navigation});
        if (cached) return cached;
        try {
            const response = await fetch(event.request);
            if (response.ok && response.type === 'basic') await cache.put(event.request, response.clone());
            return response;
        } catch (error) {
            if (navigation) return (await cache.match('./index.html')) || Response.error();
            return Response.error();
        }
    }));
});
