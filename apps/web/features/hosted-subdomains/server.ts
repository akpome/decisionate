import "server-only"
import { cache } from "react"
import { headers } from "next/headers"
import { getAuthRequestOrigin, getSafeReturnTo } from "@/features/auth/lib/auth-redirects"
import { getHostedAuthReturnUrl, hostedPrimaryOrigin, type HostedPortal, isHostedHostname } from "./types"

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
    if (portal.hostname !== hostname || portal.origin !== `https://${hostname}`) return null
    if (portal.redirect_origin) {
      const target = new URL(portal.redirect_origin)
      if (target.hostname === hostname || !isHostedHostname(target.hostname) || portal.redirect_origin !== `https://${target.hostname}`) return null
    }
    return portal
  } catch { return null }
}

export const requestHostedPortal = cache(async () => {
  const host = (await headers()).get("host") || ""
  return resolveHostedPortal(host)
})

export function getHostedAddressForwardUrl(previous: URL, origin: string) {
  const target = new URL(origin)
  target.pathname = previous.pathname
  target.search = previous.search
  target.hash = previous.hash
  for (const key of [...target.searchParams.keys()]) {
    if (key.startsWith("__clerk") || key === "__session") target.searchParams.delete(key)
  }
  const returnTo = getSafeReturnTo(target.searchParams.get("redirect_url"), previous.origin)
  if (returnTo) target.searchParams.set("redirect_url", returnTo)
  else target.searchParams.delete("redirect_url")
  if (target.pathname === "/auth/redirect") target.searchParams.set("__clerk_synced", "false")
  return target
}

async function resolveHostedReturn(value: string | null) {
  if (!value || /[\\\s]/.test(value)) return null
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.username || url.password || url.port || !isHostedHostname(url.hostname)) return null
    // Clerk's session-sync marker is preserved; destinations remain application routes only.
    if (url.pathname !== "/auth/redirect" && !getSafeReturnTo(url.pathname + url.search, url.origin)) return null
    const portal = await resolveHostedPortal(url.hostname)
    if (portal?.redirect_origin) {
      const target = await resolveHostedPortal(new URL(portal.redirect_origin).hostname)
      if (!target?.active || target.id !== portal.id) return null
      const forwarded = getHostedAddressForwardUrl(url, target.origin)
      return { portal: target, url: getHostedAuthReturnUrl(forwarded.href) }
    }
    if (!portal?.active) return null
    return { portal, url: getHostedAuthReturnUrl(url.href) }
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
