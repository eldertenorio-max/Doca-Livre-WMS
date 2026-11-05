// Service worker mínimo do Doca Livre.
// Objetivo: PWA instalável. HTML e SW sempre da rede; assets com hash podem ir ao cache.
const CACHE = 'ultrafrio-shell-v14'
const SHELL = ['/manifest.webmanifest', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // Nunca cachear o próprio SW — senão o app fica preso na versão antiga.
  if (url.pathname === '/sw.js') return

  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((res) => res)
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/'))),
    )
    return
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && url.pathname.startsWith('/assets/')) {
          const copy = res.clone()
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => undefined)
        }
        return res
      })
      .catch(() => caches.match(req)),
  )
})
