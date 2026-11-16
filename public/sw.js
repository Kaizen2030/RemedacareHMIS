// RemedacareHMS service worker: lets the installed app (iPhone/Android home screen) open quickly and show the
// sign-in page when the network is poor. It stores ONLY the app's own code and pages.
// Patient data comes from Supabase (another address) and is never stored here: shared phones must not keep records.
const CACHE = 'remedacare-shell-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('remedacare-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // Supabase, payments, maps: always live, never cached

  // pages: newest from the network; the saved copy only when offline
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(new URL('./', self.registration.scope).href, copy)) }
          return res
        })
        .catch(() => caches.match(new URL('./', self.registration.scope).href)),
    )
    return
  }

  // built files have a content hash in their name, so a saved copy is always correct
  if (url.pathname.includes('/assets/') || /\.(png|svg|ico|json|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)) }
        return res
      })),
    )
  }
})
