import "server-only"
import { cache } from "react"
import { headers } from "next/headers"
import { getAuthRequestOrigin, getSafeReturnTo } from "@/features/auth/lib/auth-redirects"
import { hostedPrimaryOrigin, type HostedPortal, isHostedHostname } from "./types"

export async function resolveHostedPortal(hostname: string): Promise<HostedPortal | null> {
  if (!isHostedHostname(hostname)) return null
  const api = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "")
  if (!api) return null
  try {
    const response = await fetch(`${api}/api/v2/hosted-subdomains/resolve?hostname=${encodeURIComponent(hostname)}`, {
      cache: "no-store", signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return null
    const portal: HostedPortal = await response.json()
    return portal.hostname === hostname && portal.origin === `https://${hostname}` ? portal : null
  } catch { return null }
}

export const requestHostedPortal = cache(async () => {
  const host = (await headers()).get("host") || ""
  return resolveHostedPortal(host)
})

async function resolveHostedReturn(value: string | null) {
  if (!value || /[\\\s]/.test(value)) return null
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.username || url.password || url.port || !isHostedHostname(url.hostname)) return null
    // Clerk's session-sync marker is preserved; destinations remain application routes only.
    if (url.pathname !== "/auth/redirect" && !getSafeReturnTo(url.pathname + url.search, url.origin)) return null
    const portal = await resolveHostedPortal(url.hostname)
    if (!portal?.active) return null
    return { portal, url: url.href }
  } catch { return null }
}

export async function safeHostedReturn(value: string | null) {
  return (await resolveHostedReturn(value))?.url || null
}

export const requestHostedAuthPortal = cache(async () => {
  const requestHeaders = await headers()
  if (getAuthRequestOrigin(requestHeaders) !== hostedPrimaryOrigin) return null
  const resolved = await resolveHostedReturn(requestHeaders.get("x-decisionate-hosted-return"))
  return resolved?.portal.branding ? resolved.portal : null
})
