"use client"

import { ClerkProvider, useAuth } from "@clerk/nextjs"
import { useEffect } from "react"
import type { ReactNode } from "react"
import { setClerkSessionTokenProvider } from "@/lib/api"
import { AUTH_REDIRECTS } from "@/features/auth/lib/auth-redirects"
import { getHostedLogo, hostedPrimaryOrigin, type HostedPortal } from "@/features/hosted-subdomains/types"

type AppClerkProviderProps = {
  children: ReactNode
  portal?: HostedPortal | null
  hostedReturn?: string | null
  authPortal?: HostedPortal | null
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
  authPortal,
}: AppClerkProviderProps) {
  const authBrand = authPortal?.branding
  return (
    <ClerkProvider
      {...(portal ? { isSatellite: true, domain: portal.hostname, proxyUrl: portal.origin + "/__clerk",
        signInUrl: hostedPrimaryOrigin + "/sign-in", signUpUrl: hostedPrimaryOrigin + "/sign-up" } : {})}
      {...(authBrand ? {
        appearance: {
          options: {
            logoImageUrl: getHostedLogo(authBrand) || undefined,
            logoLinkUrl: authPortal.origin,
            helpPageUrl: `mailto:${authBrand.support_email}`,
          },
          variables: { colorPrimary: authBrand.primary_color },
          elements: { logoBox: { display: "none" } },
        },
        localization: {
          signIn: {
            start: { title: "Sign in", titleCombined: "Continue", alternativePhoneCodeProvider: { title: "Sign in with {{provider}}" } },
            alternativePhoneCodeProvider: { subtitle: "to continue to your workspace" },
            emailCode: { subtitle: "to continue to your workspace" },
            emailCodeMfa: { subtitle: "to continue to your workspace" },
            emailLink: { subtitle: "to continue to your workspace" },
            emailLinkMfa: { subtitle: "to continue to your workspace" },
            phoneCode: { subtitle: "to continue to your workspace" },
          },
          signUp: {
            start: { alternativePhoneCodeProvider: { title: "Sign up with {{provider}}" } },
            emailLink: { subtitle: "to continue to your workspace" },
          },
        },
      } : {})}
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
