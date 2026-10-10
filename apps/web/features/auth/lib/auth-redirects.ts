export const AUTH_REDIRECTS = {
  afterLogin: "/auth/redirect",
  afterSignup: "/auth/redirect",
} as const

type RedirectValue = string | string[] | null | undefined

export function getAuthRequestOrigin(headers?: Pick<Headers, "get">, fallbackUrl = "https://decisionate.invalid") {
  const host = (headers?.get("x-forwarded-host") ?? headers?.get("host"))?.split(",")[0].trim()
  const protocol = headers?.get("x-forwarded-proto")?.split(",")[0].trim()
    ?? new URL(fallbackUrl).protocol.replace(":", "")
  if (!host || /[\\/@?#\s]/.test(host) || !["http", "https"].includes(protocol)) {
    return new URL(fallbackUrl).origin
  }
  try {
    return new URL(`${protocol}://${host}`).origin
  } catch {
    return new URL(fallbackUrl).origin
  }
}

export function getSafeReturnTo(value: RedirectValue, origin?: string): string | null {
  let candidate = Array.isArray(value) ? value[0] : value
  if (
    !candidate || candidate.startsWith("//") ||
    /[\\\u0000-\u0020\u007f]/.test(candidate)
  ) {
    return null
  }

  try {
    const base = origin ? new URL(origin).origin : "https://decisionate.invalid"
    if (!candidate.startsWith("/") && (!origin || !/^https?:\/\//i.test(candidate))) return null
    if (/(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i.test(candidate.split(/[?#]/)[0])) return null
    const url = new URL(candidate, base)
    if (url.origin !== base || url.username || url.password) return null
    if (!candidate.startsWith("/")) candidate = `${url.pathname}${url.search}${url.hash}`
    const rawPath = candidate.split(/[?#]/)[0]
    const pathname = decodeURIComponent(rawPath)
    // Reject encoded separators, double encoding, and path traversal before
    // handing a destination to either the browser router or the proxy.
    if (
      /%2f|%5c/i.test(rawPath) ||
      /[%\\\u0000-\u0020\u007f]/.test(pathname) ||
      pathname.split("/").some(part => part === "." || part === "..")
    ) {
      return null
    }

    if (!["/dashboard", "/onboarding", "/platform-admin"].some(route => pathname === route || pathname.startsWith(`${route}/`))) {
      return null
    }

    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
}

function withReturnTo(path: string, value: RedirectValue) {
  const returnTo = getSafeReturnTo(value)
  return returnTo ? `${path}?redirect_url=${encodeURIComponent(returnTo)}` : path
}

export const getAuthRedirectUrl = (value?: RedirectValue) => withReturnTo("/auth/redirect", value)
export const getSignInUrl = (value?: RedirectValue) => withReturnTo("/sign-in", value)
export const getSignUpUrl = (value?: RedirectValue) => withReturnTo("/sign-up", value)
export const getOnboardingUrl = (value?: RedirectValue) => withReturnTo("/onboarding", value)

export function getDashboardReturnTo(value: RedirectValue, origin?: string) {
  const returnTo = getSafeReturnTo(value, origin)
  if (returnTo?.startsWith("/dashboard")) return returnTo
  if (returnTo?.split(/[?#]/)[0] === "/onboarding") {
    const nested = getSafeReturnTo(new URL(returnTo, "https://decisionate.invalid").searchParams.get("redirect_url"), origin)
    if (nested?.startsWith("/dashboard")) return nested
  }
  return null
}

export function getWorkspaceReturnTo(value: RedirectValue, origin?: string) {
  return getDashboardReturnTo(value, origin) ?? "/dashboard"
}
