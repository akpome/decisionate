"use client"

import { ClerkProvider, useAuth } from "@clerk/nextjs"
import { useEffect } from "react"
import type { ReactNode } from "react"
import { setClerkSessionTokenProvider } from "@/lib/api"
import { AUTH_REDIRECTS } from "@/features/auth/lib/auth-redirects"

type AppClerkProviderProps = {
  children: ReactNode
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
}: AppClerkProviderProps) {
  return (
    <ClerkProvider
      signInFallbackRedirectUrl={AUTH_REDIRECTS.afterLogin}
      signInForceRedirectUrl={AUTH_REDIRECTS.afterLogin}
      signUpFallbackRedirectUrl={AUTH_REDIRECTS.afterSignup}
      signUpForceRedirectUrl={AUTH_REDIRECTS.afterSignup}
    >
      <ClerkTokenBridge />
      {children}
    </ClerkProvider>
  )
}
