import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"
import {
  NextFetchEvent,
  NextRequest,
  NextResponse,
} from "next/server"

const isPublicDemoRoute = createRouteMatcher([
  "/",
  "/demo(.*)",
])

const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/onboarding(.*)",
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

    if (userId && isSignInRoute(req)) {
      return NextResponse.redirect(
        new URL("/auth/redirect", req.url)
      )
    }

    if (userId && isSignUpRoute(req)) {
      return NextResponse.redirect(
        new URL("/onboarding", req.url)
      )
    }
  }

  if (isProtectedRoute(req)) {
    await auth.protect()
  }
})

export default function proxy(
  request: NextRequest,
  event: NextFetchEvent,
) {
  if (isPublicDemoRoute(request)) {
    return NextResponse.next()
  }

  return clerkProxy(request, event)
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpg|jpeg|gif|png|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
}
