import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"
import {
  NextFetchEvent,
  NextRequest,
  NextResponse,
} from "next/server"
import {
  getAuthRedirectUrl,
  getAuthRequestOrigin,
  getSafeReturnTo,
  getSignInUrl,
} from "./features/auth/lib/auth-redirects"

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
