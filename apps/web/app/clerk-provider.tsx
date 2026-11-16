"use client"

import { ClerkProvider, useAuth } from "@clerk/nextjs"
import { useEffect } from "react"
import type { ReactNode } from "react"
import { setClerkSessionTokenProvider } from "@/lib/api"
import { AUTH_REDIRECTS } from "@/features/auth/lib/auth-redirects"
import { hostedPrimaryOrigin, type HostedPortal } from "@/features/hosted-subdomains/types"

type AppClerkProviderProps = {
  children: ReactNode
  portal?: HostedPortal | null
  hostedReturn?: string | null
}

function ClerkTokenBridge() {
  const { getToken } = useAuth()

  useEffect(() => {
    setClerkSessionTokenProvider(getToken)

    return () => {
      setClerkSessionTokenProvider(null)
    }
  }, [getToken])

  return null
}

export function AppClerkProvider({
  children,
  portal,
  hostedReturn,
}: AppClerkProviderProps) {
  return (
    <ClerkProvider
      {...(portal ? { isSatellite: true, domain: portal.hostname, proxyUrl: portal.origin + "/__clerk",
        signInUrl: hostedPrimaryOrigin + "/sign-in", signUpUrl: hostedPrimaryOrigin + "/sign-up" } : {})}
      allowedRedirectOrigins={hostedReturn ? [new URL(hostedReturn).origin] : undefined}
      afterSignOutUrl={AUTH_REDIRECTS.afterSignOut}
      signInFallbackRedirectUrl={AUTH_REDIRECTS.afterLogin}
      signInForceRedirectUrl={hostedReturn || (portal ? undefined : AUTH_REDIRECTS.afterLogin)}
      signUpFallbackRedirectUrl={AUTH_REDIRECTS.afterSignup}
      signUpForceRedirectUrl={hostedReturn || (portal ? undefined : AUTH_REDIRECTS.afterSignup)}
    >
      <ClerkTokenBridge />
      {children}
    </ClerkProvider>
  )
}
