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

const clerkProxy = clerkMiddleware(async (auth, req) => {
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
  }
  if (isPublicDemoRoute(request)) {
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
