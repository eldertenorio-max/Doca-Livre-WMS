/* WMS DOCA LIVRE PRO — service worker mínimo (instalação PWA). */

const CACHE = 'dl-wms-shell-v4'
const SHELL = [
  '/manifest.webmanifest',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
  '/static/logo-doca-livre-v2.png',
  '/static/doca-livre-icone.png',
]

function _isShellAsset(pathname) {
  return SHELL.some(function (p) {
    return pathname === p
  })
}

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

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/static/icons/icon-192.png')),
    )
    return
  }

  /* Só ícones/manifest — nunca API, HTML nem JS da aplicação (evita 429 e dados velhos). */
  if (!_isShellAsset(url.pathname)) return

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached
      return fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone()
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => undefined)
        }
        return res
      })
    }),
  )
})
