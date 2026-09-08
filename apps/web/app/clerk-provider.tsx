"use client"

import { ClerkProvider, useAuth } from "@clerk/nextjs"
import { useEffect } from "react"
import type { ReactNode } from "react"
import { setClerkSessionTokenProvider } from "@/lib/api"

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
      signInFallbackRedirectUrl="/auth/redirect"
      signInForceRedirectUrl="/auth/redirect"
      signUpFallbackRedirectUrl="/onboarding"
      signUpForceRedirectUrl="/onboarding"
    >
      <ClerkTokenBridge />
      {children}
    </ClerkProvider>
  )
}
