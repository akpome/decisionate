import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"
import {
  NextFetchEvent,
  NextRequest,
  NextResponse,
} from "next/server"
import {
  getAuthRedirectUrl,
  getAuthRequestOrigin,
  getHostedInvitationWorkspaceId,
  getInvitedWorkspaceId,
  getSafeReturnTo,
  getSignInUrl,
} from "./features/auth/lib/auth-redirects"
import { portalBrand } from "./lib/portal-brand"
import { DECISIONATE_APPLICATION_ORIGIN, DECISIONATE_MARKETING_ORIGIN } from "./lib/decisionate-domains"
import { canonicalWorkspacePathname, internalWorkspacePathname, isWorkspacePathname } from "./lib/application-routes"
import { getHostedAddressForwardUrl, resolveHostedPortal, safeHostedReturn } from "./features/hosted-subdomains/server"
import { hostedPrimaryOrigin, isHostedHostname, isPrimaryOnlyPortalPath, type HostedPortal } from "./features/hosted-subdomains/types"
import { unavailablePortalPage, unavailablePortalHeaders } from "./features/hosted-subdomains/unavailable-page"

const isPublicDemoRoute = createRouteMatcher([
  "/",
  "/demo(.*)",
  "/privacy",
  "/terms",
  "/security",
])
const isLegacyProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/onboarding(.*)",
  "/platform-admin(.*)",
])

function isProtectedRoute(request: NextRequest) {
  return isLegacyProtectedRoute(request) || isWorkspacePathname(canonicalWorkspacePathname(request.nextUrl.pathname))
}

function redirectApplicationPath(request: NextRequest, origin: string, pathname: string, status: number) {
  const destination = new URL(origin)
  destination.pathname = pathname
  destination.search = request.nextUrl.search
  const returnTo = getSafeReturnTo(request.nextUrl.searchParams.get("redirect_url"), getAuthRequestOrigin(request.headers, request.url))
  if (returnTo) destination.searchParams.set("redirect_url", returnTo)
  return NextResponse.redirect(destination, status)
}
const isSignInRoute = createRouteMatcher([
  "/sign-in(.*)",
])
const isSignUpRoute = createRouteMatcher([
  "/sign-up(.*)",
])

function isApplicationHome(request: NextRequest) {
  return !portalBrand.id && request.nextUrl.pathname === "/" &&
    new URL(getAuthRequestOrigin(request.headers, request.url)).hostname === "app.decisionate.ca"
}

function clerkProxy(portal: HostedPortal | null, hostedReturn: string | null) {
 return clerkMiddleware(async (auth, req) => {
  if (portal && req.nextUrl.pathname === "/") {
    const { userId } = await auth()
    return NextResponse.redirect(new URL(userId ? "/auth/redirect" : "/sign-in", portal.origin))
  }
  if (isApplicationHome(req)) {
    const { userId } = await auth()
    const returnTo = getSafeReturnTo(req.nextUrl.searchParams.get("redirect_url"), DECISIONATE_APPLICATION_ORIGIN)
    return NextResponse.redirect(new URL(
      userId ? getAuthRedirectUrl(returnTo) : getSignInUrl(returnTo), DECISIONATE_APPLICATION_ORIGIN,
    ), { status: 307, headers: { "Cache-Control": "private, no-store" } })
  }

  if (isSignInRoute(req) || isSignUpRoute(req)) {
    const { userId } = await auth()

    if (userId) {
      if (hostedReturn) {
        // An invitation may be opened in a browser signed into another
        // account. Render the account choice on the primary Clerk host.
        if (["/sign-in", "/sign-up"].includes(req.nextUrl.pathname.replace(/\/$/, "")) && getHostedInvitationWorkspaceId(hostedReturn)) {
          return NextResponse.next({ request: { headers: req.headers } })
        }
        return NextResponse.redirect(hostedReturn)
      }
      const origin = getAuthRequestOrigin(req.headers, req.url)
      const returnTo = getSafeReturnTo(req.nextUrl.searchParams.get("redirect_url"), origin)
      if (isSignInRoute(req) && req.nextUrl.searchParams.get("switch_account") === "1" && getInvitedWorkspaceId(returnTo)) {
        return
      }
      return NextResponse.redirect(
        new URL(getAuthRedirectUrl(returnTo), origin)
      )
    }
  }

  if (isProtectedRoute(req)) {
    const { userId } = await auth()

    if (!userId) {
      return NextResponse.redirect(new URL(
        getSignInUrl(`${req.nextUrl.pathname}${req.nextUrl.search}`), getAuthRequestOrigin(req.headers, req.url),
      ))
    }
  }
  // Resolve clean URLs here, after authentication, so document and RSC
  // requests reach the same page without relying on a second rewrite pass.
  const internalPathname = internalWorkspacePathname(req.nextUrl.pathname)
  if (internalPathname !== req.nextUrl.pathname) {
    const destination = req.nextUrl.clone()
    destination.pathname = internalPathname
    return NextResponse.rewrite(destination, { request: { headers: req.headers } })
  }
  return NextResponse.next({ request: { headers: req.headers } })
 }, portal ? {
   isSatellite: true, domain: portal.hostname,
   signInUrl: hostedPrimaryOrigin + "/sign-in", signUpUrl: hostedPrimaryOrigin + "/sign-up",
   frontendApiProxy: { enabled: true },
 } : {})
}

export default async function proxy(
  request: NextRequest,
  event: NextFetchEvent,
) {
  const hostname = request.nextUrl.hostname
  const hosted = !portalBrand.id && (hostname === "decisionate.app" || hostname.endsWith(".decisionate.app"))
  let portal: HostedPortal | null = null
  let hostedReturn: string | null = null
  const trustedHeaders = new Headers(request.headers)
  trustedHeaders.delete("x-decisionate-hosted-return")
  if (hosted) {
    portal = isHostedHostname(hostname) ? await resolveHostedPortal(hostname) : null
    if (portal?.redirect_origin && !request.nextUrl.pathname.startsWith("/__clerk/") &&
        ["GET", "HEAD"].includes(request.method)) {
      const target = getHostedAddressForwardUrl(new URL(request.nextUrl.href), portal.redirect_origin)
      return NextResponse.redirect(target, { status: 307, headers: { "Cache-Control": "no-store" } })
    }
    if (!portal || (!portal.active && !request.nextUrl.pathname.startsWith("/__clerk/"))) {
      return new NextResponse(unavailablePortalPage, { status: 404, headers: unavailablePortalHeaders })
    }
    const canonical = canonicalWorkspacePathname(request.nextUrl.pathname)
    if (isPrimaryOnlyPortalPath(canonical)) {
      return new NextResponse("Not found", { status: 404 })
    }
    if (["/privacy", "/terms", "/security"].includes(request.nextUrl.pathname)) {
      return NextResponse.redirect(new URL(request.nextUrl.pathname, DECISIONATE_MARKETING_ORIGIN))
    }
    // Clerk's satellite sync requires a document destination. Older browsers
    // may send an HTML navigation without Fetch Metadata headers.
    if (request.nextUrl.pathname === "/auth/redirect" && request.method === "GET" &&
        request.nextUrl.searchParams.get("__clerk_synced") === "false" &&
        !trustedHeaders.has("sec-fetch-dest") && !trustedHeaders.has("rsc") &&
        trustedHeaders.get("accept")?.startsWith("text/html")) {
      trustedHeaders.set("sec-fetch-dest", "document")
    }
  } else if (!portalBrand.id && hostname === "app.decisionate.ca" && (isSignInRoute(request) || isSignUpRoute(request))) {
    hostedReturn = await safeHostedReturn(request.nextUrl.searchParams.get("redirect_url"))
    if (hostedReturn) trustedHeaders.set("x-decisionate-hosted-return", hostedReturn)
  }
  request = new NextRequest(request, { headers: trustedHeaders })
  if (portalBrand.id) {
    if (!portalBrand.url || request.nextUrl.hostname !== new URL(portalBrand.url).hostname) {
      return new NextResponse("Portal unavailable on this address.", { status: 404 })
    }
    if (["/privacy", "/terms"].includes(request.nextUrl.pathname)) {
      return NextResponse.redirect(new URL(request.nextUrl.pathname === "/privacy" ? portalBrand.privacy : portalBrand.terms))
    }
    if (isPublicDemoRoute(request)) return NextResponse.redirect(new URL("/sign-in", portalBrand.url))
    if (request.nextUrl.pathname.startsWith("/platform-admin") || canonicalWorkspacePathname(request.nextUrl.pathname).startsWith("/white-label")) {
      return new NextResponse("Not found", { status: 404 })
    }
  } else if (!hosted) {
    const origin = getAuthRequestOrigin(request.headers, request.url)
    const hostname = new URL(origin).hostname
    const isLegacyMarketing = hostname === "www.decisionate.ca"
    const isApplicationRoute = isProtectedRoute(request) || /^\/(sign-in|sign-up|auth)(\/|$)/.test(request.nextUrl.pathname)
    const target = isLegacyMarketing ? DECISIONATE_MARKETING_ORIGIN
      : hostname === "decisionate.ca" && isApplicationRoute ? DECISIONATE_APPLICATION_ORIGIN : null
    if (target) {
      return redirectApplicationPath(request, target, canonicalWorkspacePathname(request.nextUrl.pathname), isLegacyMarketing ? 308 : 307)
    }
  }
  const canonicalPathname = canonicalWorkspacePathname(request.nextUrl.pathname)
  if (canonicalPathname !== request.nextUrl.pathname) {
    return redirectApplicationPath(request, getAuthRequestOrigin(request.headers, request.url), canonicalPathname, 308)
  }
  if (["/robots.txt", "/sitemap.xml"].includes(request.nextUrl.pathname)) {
    return NextResponse.next()
  }
  if (isPublicDemoRoute(request) && !isApplicationHome(request) && !hosted) {
    return NextResponse.next()
  }

  const response = await clerkProxy(portal, hostedReturn)(request, event)
  // Clerk stamps its verified request headers through a rewrite to the
  // current URL. Treat that as a continuation so Next does not proxy back
  // into itself when internal and public hostnames differ.
  if (response?.headers?.get("x-middleware-rewrite") === request.url) {
    response.headers.delete("x-middleware-rewrite")
    response.headers.set("x-middleware-next", "1")
  }
  return response
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpg|jpeg|gif|png|webp|avif|svg|webm|mp4|vtt|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
}
