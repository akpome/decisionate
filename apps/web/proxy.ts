import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"
import {
  NextFetchEvent,
  NextRequest,
  NextResponse,
} from "next/server"
import {
  getAuthRedirectUrl,
  getAuthRequestOrigin,
  getInvitedWorkspaceId,
  getSafeReturnTo,
  getSignInUrl,
} from "./features/auth/lib/auth-redirects"
import { portalBrand } from "./lib/portal-brand"
import { DECISIONATE_APPLICATION_ORIGIN, DECISIONATE_MARKETING_ORIGIN } from "./lib/decisionate-domains"

const isPublicDemoRoute = createRouteMatcher([
  "/",
  "/demo(.*)",
  "/privacy",
  "/terms",
  "/security",
])
const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/onboarding(.*)",
  "/platform-admin(.*)",
])
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

const clerkProxy = clerkMiddleware(async (auth, req) => {
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
})

export default async function proxy(
  request: NextRequest,
  event: NextFetchEvent,
) {
  if (portalBrand.id) {
    if (!portalBrand.url || request.nextUrl.hostname !== new URL(portalBrand.url).hostname) {
      return new NextResponse("Portal unavailable on this address.", { status: 404 })
    }
    if (["/privacy", "/terms"].includes(request.nextUrl.pathname)) {
      return NextResponse.redirect(new URL(request.nextUrl.pathname === "/privacy" ? portalBrand.privacy : portalBrand.terms))
    }
    if (isPublicDemoRoute(request)) return NextResponse.redirect(new URL("/sign-in", portalBrand.url))
    if (request.nextUrl.pathname.startsWith("/platform-admin") || request.nextUrl.pathname.startsWith("/dashboard/white-label")) {
      return new NextResponse("Not found", { status: 404 })
    }
  } else {
    const origin = getAuthRequestOrigin(request.headers, request.url)
    const hostname = new URL(origin).hostname
    const isLegacyMarketing = hostname === "www.decisionate.ca"
    const isApplicationRoute = /^\/(sign-in|sign-up|auth|dashboard|onboarding|platform-admin)(\/|$)/.test(request.nextUrl.pathname)
    const target = isLegacyMarketing ? DECISIONATE_MARKETING_ORIGIN
      : hostname === "decisionate.ca" && isApplicationRoute ? DECISIONATE_APPLICATION_ORIGIN : null
    if (target) {
      const destination = new URL(target)
      destination.pathname = request.nextUrl.pathname
      destination.search = request.nextUrl.search
      // Old invitations may carry an absolute return URL on the previous host.
      const returnTo = getSafeReturnTo(request.nextUrl.searchParams.get("redirect_url"), origin)
      if (returnTo) destination.searchParams.set("redirect_url", returnTo)
      return NextResponse.redirect(destination, isLegacyMarketing ? 308 : 307)
    }
  }
  if (isPublicDemoRoute(request) && !isApplicationHome(request)) {
    return NextResponse.next()
  }

  const response = await clerkProxy(request, event)
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
  ],
}
