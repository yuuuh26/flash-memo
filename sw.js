const CACHE='flash-memo-shell-v1.0.0-r3';
const ROOT=new URL('./',self.location).href;
const ASSETS=['./','./index.html','./style.css','./js/app.js','./js/db.js','./js/model.js','./js/backup.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./icons/icon-maskable-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS.map(path=>new Request(new URL(path,ROOT).href,{cache:'reload'}))))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('flash-memo-shell-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(ROOT))return;
  event.respondWith((async()=>{const cached=await caches.match(event.request);if(cached)return cached;try{return await fetch(event.request);}catch(error){if(event.request.mode==='navigate')return await caches.match(new URL('./index.html',ROOT).href);throw error;}})());
});
