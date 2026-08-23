"use client"

import { ClerkProvider } from "@clerk/nextjs"
import type { ReactNode } from "react"

type AppClerkProviderProps = {
  children: ReactNode
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
      {children}
    </ClerkProvider>
  )
}
