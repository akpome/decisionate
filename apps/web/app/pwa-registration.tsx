"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import { isDecisionatePwaHost } from "@/lib/decisionate-domains"
import { canonicalWorkspacePathname, isWorkspacePathname } from "@/lib/application-routes"

async function retireDecisionatePwa() {
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.filter(registration =>
        [registration.active, registration.waiting, registration.installing].some(worker => {
          if (!worker) return false
          const script = new URL(worker.scriptURL)
          return script.origin === window.location.origin && script.pathname === "/sw.js"
        })
      ).map(registration => registration.unregister()))
    }
  } catch {
    // Cleanup must not block the marketing page or other registrations.
  }
  try {
    if ("caches" in window) {
      const names = await window.caches.keys()
      await Promise.all(names.filter(name => name.startsWith("decisionate-pwa-")).map(name => window.caches.delete(name)))
    }
  } catch {
    // Cache storage may be unavailable in private browsing.
  }
}

export function PwaRegistration() {
  const pathname = usePathname()
  const workspacePage = isWorkspacePathname(canonicalWorkspacePathname(pathname))

  useEffect(() => {
    if (workspacePage && isDecisionatePwaHost(window.location.hostname)) return
    const suppressInstall = (event: Event) => event.preventDefault()
    window.addEventListener("beforeinstallprompt", suppressInstall)
    return () => window.removeEventListener("beforeinstallprompt", suppressInstall)
  }, [workspacePage])

  useEffect(() => {
    if (!isDecisionatePwaHost(window.location.hostname) || process.env.NODE_ENV !== "production") {
      void retireDecisionatePwa()
      return
    }
    // Keep an existing installation working across sign-in; only workspace
    // pages advertise a manifest or initiate service-worker registration.
    if (!workspacePage) return
    if (!("serviceWorker" in navigator)) {
      return
    }

    if (window.location.protocol !== "https:") {
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
  }, [workspacePage])

  return null
}
