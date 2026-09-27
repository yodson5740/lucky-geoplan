/* Lucky GéoPlan — service worker : application hors ligne + carte hors ligne (tuiles en cache, agrandissement automatique) */
const APP_CACHE='lucky-geoplan-app-v30', TILE_CACHE='bornix-tiles-v1', MAX_TILES=120000;
const SHELL=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png',
  'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css','https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'];
const TILE_HOSTS=/(^|\.)tile\.openstreetmap\.org$|^server\.arcgisonline\.com$/;
self.addEventListener('install',e=>{ e.waitUntil(caches.open(APP_CACHE).then(c=>Promise.allSettled(SHELL.map(u=>c.add(u)))).then(()=>self.skipWaiting())); });
self.addEventListener('activate',e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==APP_CACHE&&k!==TILE_CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
let puts=0;
async function trimTiles(){ const c=await caches.open(TILE_CACHE), keys=await c.keys(); if(keys.length>MAX_TILES) for(const k of keys.slice(0,keys.length-MAX_TILES)) await c.delete(k); }
// Repère z/x/y d'une tuile et fabrique l'adresse d'une tuile parente
function parseTile(u){
  let m=u.match(/tile\.openstreetmap\.org\/(\d+)\/(\d+)\/(\d+)\.png/);
  if(m) return {z:+m[1],x:+m[2],y:+m[3],mk:(z,x,y)=>`https://${'abc'[Math.abs(x+y)%3]}.tile.openstreetmap.org/${z}/${x}/${y}.png`};
  m=u.match(/^(.*\/MapServer\/tile\/)(\d+)\/(\d+)\/(\d+)/);
  if(m) return {z:+m[2],y:+m[3],x:+m[4],mk:(z,x,y)=>`${m[1]}${z}/${y}/${x}`};
  return null;
}
// Hors ligne : si la tuile manque, on agrandit la portion correspondante d'une tuile parente déjà en cache
async function overzoom(url){
  const t=parseTile(url); if(!t||typeof OffscreenCanvas==='undefined'||typeof createImageBitmap==='undefined') return null;
  const c=await caches.open(TILE_CACHE);
  for(let d=1; d<=12 && t.z-d>=0; d++){
    const px=t.x>>d, py=t.y>>d, r=await c.match(t.mk(t.z-d,px,py));
    if(!r||r.type==='opaque') continue;
    try{
      const bmp=await createImageBitmap(await r.blob()), n=1<<d, sz=bmp.width/n;
      const cv=new OffscreenCanvas(256,256), ctx=cv.getContext('2d'); ctx.imageSmoothingQuality='high';
      ctx.drawImage(bmp,(t.x-px*n)*sz,(t.y-py*n)*sz,sz,sz,0,0,256,256);
      const blob=await cv.convertToBlob({type:'image/png'});
      return new Response(blob,{headers:{'Content-Type':'image/png','X-Bornix-Overzoom':String(d)}});
    }catch(e){}
  }
  return null;
}
self.addEventListener('fetch',e=>{
  const req=e.request; if(req.method!=='GET') return;
  const url=new URL(req.url);
  if(TILE_HOSTS.test(url.hostname)){
    e.respondWith((async()=>{
      const c=await caches.open(TILE_CACHE), hit=await c.match(req.url); if(hit) return hit;
      try{ const r=await fetch(req.url,{mode:'cors'}); if(r.ok){ c.put(req.url,r.clone()); if(++puts%300===0) trimTiles(); return r; } }catch(err){}
      const oz=await overzoom(req.url); if(oz) return oz;
      try{ return await fetch(req.url,{mode:'no-cors'}); }catch(err){ return new Response('',{status:504}); }
    })());
    return;
  }
  if(url.hostname==='cdn.jsdelivr.net'||url.hostname==='cdnjs.cloudflare.com'){
    e.respondWith(caches.match(req).then(h=>h||fetch(req).then(r=>{ const cp=r.clone(); caches.open(APP_CACHE).then(c=>c.put(req,cp)); return r; })));
    return;
  }
  if(url.origin===location.origin){
    e.respondWith(fetch(req).then(r=>{ const cp=r.clone(); caches.open(APP_CACHE).then(c=>c.put(req,cp)); return r; }).catch(()=>caches.match(req).then(h=>h||caches.match('./index.html'))));
  }
});
