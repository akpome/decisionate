"use client"

import { ClerkProvider } from "@clerk/nextjs"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

type AppClerkProviderProps = {
  children: ReactNode
}

export function AppClerkProvider({
  children,
}: AppClerkProviderProps) {
  const pathname = usePathname()
  const isPublicPath =
    pathname === "/" ||
    pathname === "/demo" ||
    pathname?.startsWith("/share") ||
    pathname?.startsWith("/privacy") ||
    pathname?.startsWith("/terms") ||
    pathname?.startsWith("/security")

  if (isPublicPath) {
    return <>{children}</>
  }

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
