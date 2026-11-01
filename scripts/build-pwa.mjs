import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = path.resolve('dist');
function walk(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]); }
const files = walk(root).filter(f=>!f.endsWith('service-worker.js') && !f.endsWith('.map'));
const hash = crypto.createHash('sha256');
for (const file of files.sort()) hash.update(path.relative(root,file)).update(fs.readFileSync(file));
const version = hash.digest('hex').slice(0,16);
const urls = files.map(f=>'./'+path.relative(root,f).replaceAll('\\','/'));
fs.writeFileSync(path.join(root,'service-worker.js'), `/* Generated from the complete Astro build. */
const CACHE_NAME = 'pickleball-queue-astro-${version}';
const ASSETS = ${JSON.stringify(['./',...urls])};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', event => {
  // Retain old build assets for documents still open during an upgrade.
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', event => {
  if(event.request.method!=='GET' || new URL(event.request.url).origin!==self.location.origin) return;
  event.respondWith((async()=>{
    const cache = await caches.open(CACHE_NAME);
    if(event.request.mode==='navigate') {
      try { const response=await fetch(event.request); if(response.ok) return response; } catch {}
      const cached=await cache.match(event.request,{ignoreSearch:true,ignoreVary:true});
      return cached || Response.error();
    }
    // Preview servers may add Vary: Origin. These are same-origin, build-owned
    // static assets; a module request's Origin must not invalidate the precache.
    const cached=await cache.match(event.request,{ignoreVary:true}) || await caches.match(event.request,{ignoreVary:true});
    return cached || fetch(event.request);
  })());
});
`);
console.log(`PWA ${version}: precaches ${urls.length + 1} build resources`);
