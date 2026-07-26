"use client"

import { useEffect } from "react"

export function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return
    }

    const isLocalhost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
    const isSecureContext =
      window.location.protocol === "https:" ||
      isLocalhost

    if (!isSecureContext) {
      return
    }

    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => {
          registrations.forEach((registration) => {
            void registration.unregister()
          })
        })
        .catch(() => {
          // Development should not fail because service worker cleanup failed.
        })

      return
    }

    const registerServiceWorker = async () => {
      try {
        const registration =
          await navigator.serviceWorker.register(
            "/sw.js",
            {
              scope: "/",
            }
          )

        registration.update().catch(() => {
          // A stale service worker is better than blocking the app shell.
        })
      } catch {
        // PWA support should never block app usage.
      }
    }

    if (document.readyState === "complete") {
      void registerServiceWorker()
      return
    }

    const handleWindowLoad = () => {
      void registerServiceWorker()
    }

    window.addEventListener(
      "load",
      handleWindowLoad
    )

    return () => {
      window.removeEventListener(
        "load",
        handleWindowLoad
      )
    }
  }, [])

  return null
}
