const CACHE_PREFIX = "decisionate-pwa"
const CACHE_VERSION = "v3"
const SHELL_CACHE = `${CACHE_PREFIX}-${CACHE_VERSION}-shell`
const STATIC_CACHE = `${CACHE_PREFIX}-${CACHE_VERSION}-static`
const OFFLINE_URL = "/offline.html"

const SHELL_ASSETS = [
  OFFLINE_URL,
  "/icons/decisionate-icon.svg",
  "/icons/decisionate-maskable.svg",
]

self.addEventListener("install", (event) => {
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
              cacheName.startsWith(CACHE_PREFIX) &&
              ![
                SHELL_CACHE,
                STATIC_CACHE,
              ].includes(cacheName)
            )
            .map((cacheName) =>
              caches.delete(cacheName)
            )
        )
      )
      .then(() => self.clients.claim())
  )
})

function shouldCacheStaticRequest(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/")
  )
}

async function cacheFirst(request) {
  const cachedResponse =
    await caches.match(request)

  if (cachedResponse) {
    return cachedResponse
  }

  const response = await fetch(request)

  if (
    response &&
    response.status === 200
  ) {
    const cache =
      await caches.open(STATIC_CACHE)
    await cache.put(
      request,
      response.clone()
    )
  }

  return response
}

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

  if (shouldCacheStaticRequest(url)) {
    event.respondWith(
      cacheFirst(request)
    )
  }
})
