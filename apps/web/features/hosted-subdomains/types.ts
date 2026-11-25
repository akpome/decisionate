export type HostedBrand = {
  name: string; logo_url: string; favicon_url: string; background_url: string
  primary_color: string; accent_color: string; background_color: string
  support_email: string; welcome_heading: string; welcome_text: string
}
export type HostedPortal = {
  id: string; hostname: string; origin: string; active: boolean
  primary_origin: string; branding: HostedBrand | null; redirect_origin?: string
}
export const getHostedLogo = (brand: Partial<HostedBrand>) => brand.logo_url || brand.favicon_url || ""
export function isHostedLogoUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password &&
      (!url.port || url.port === "443") && !/[\\\s<>]/.test(value) &&
      !Array.from(value).some(character => character.charCodeAt(0) < 32)
  } catch { return false }
}
export const hostedPrimaryOrigin = "https://app.decisionate.ca"
export const hostedWorkspaceRecoveryUrl = `${hostedPrimaryOrigin}/sign-in?redirect_url=${encodeURIComponent("/settings")}`
export function getHostedAuthReturnUrl(returnTo: string) {
  const destination = new URL(returnTo)
  if (destination.protocol !== "https:" || !isHostedHostname(destination.hostname) || destination.username || destination.password || destination.port) {
    throw new Error("A valid agency portal return address is required.")
  }
  // Clerk completes this flag after it shares the primary session with the satellite.
  destination.searchParams.set("__clerk_synced", "false")
  return destination.href
}
export function getHostedWorkspaceReturnUrl(portalOrigin: string | null | undefined, workspaceId: string) {
  if (!portalOrigin || !workspaceId) return null
  try {
    const destination = new URL("/auth/redirect", portalOrigin)
    if (destination.origin !== portalOrigin) return null
    destination.searchParams.set("redirect_url", `/dashboard?workspace_id=${encodeURIComponent(workspaceId)}`)
    return getHostedAuthReturnUrl(destination.href)
  } catch {
    return null
  }
}
export function getHostedAuthUrl(mode: "sign-in" | "sign-up", returnTo: string, clerkUrl?: string) {
  const destination = new URL(`/${mode}`, hostedPrimaryOrigin)
  try {
    const built = new URL(clerkUrl || destination.href, hostedPrimaryOrigin)
    if (built.origin === destination.origin && built.pathname === destination.pathname && !built.username && !built.password) {
      destination.search = built.search
    }
  } catch { /* Use the known primary route if Clerk has not loaded a URL yet. */ }
  // Satellites can return a bare Clerk URL; branding needs the destination on the first server request.
  destination.searchParams.set("redirect_url", getHostedAuthReturnUrl(returnTo))
  return destination.href
}
export const isHostedHostname = (hostname: string) => /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?\.decisionate\.app$/.test(hostname)
