const CACHE_PREFIX = "decisionate-pwa"
const CACHE_VERSION = "v6"
const PWA_ENABLED = self.location.hostname === "app.decisionate.ca"
const SHELL_CACHE = `${CACHE_PREFIX}-${CACHE_VERSION}-shell`
const OFFLINE_URL = "/offline.html"

const SHELL_ASSETS = [
  OFFLINE_URL,
  "/icons/decisionate-logo.png",
  "/icons/decisionate-maskable.svg",
]

self.addEventListener("install", (event) => {
  if (!PWA_ENABLED) {
    event.waitUntil(self.skipWaiting())
    return
  }
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) =>
              cacheName.startsWith(`${CACHE_PREFIX}-`) &&
              (!PWA_ENABLED || cacheName !== SHELL_CACHE)
            )
            .map((cacheName) =>
              caches.delete(cacheName)
            )
        )
      )
      .finally(() => PWA_ENABLED ? self.clients.claim() : self.registration.unregister())
  )
})

async function networkFirstNavigation(request) {
  try {
    return await fetch(request)
  } catch {
    const offlineResponse =
      await caches.match(OFFLINE_URL)

    return (
      offlineResponse ||
      new Response(
        "Decisionate is offline.",
        {
          status: 503,
          headers: {
            "Content-Type": "text/plain",
          },
        }
      )
    )
  }
}

self.addEventListener("fetch", (event) => {
  if (!PWA_ENABLED) return
  const { request } = event

  if (request.method !== "GET") {
    return
  }

  const url =
    new URL(request.url)

  if (url.origin !== self.location.origin) {
    return
  }

  if (
    request.mode === "navigate"
  ) {
    event.respondWith(
      networkFirstNavigation(request)
    )
    return
  }

})
