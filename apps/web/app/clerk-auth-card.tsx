"use client"

import {
  SignIn,
  SignUp,
} from "@clerk/nextjs"

type ClerkAuthCardProps = {
  mode: "sign-in" | "sign-up"
}

export function ClerkAuthCard({
  mode,
}: ClerkAuthCardProps) {
  if (mode === "sign-up") {
    return (
      <SignUp
        fallbackRedirectUrl="/onboarding"
        forceRedirectUrl="/onboarding"
        signInFallbackRedirectUrl="/dashboard"
      />
    )
  }

  return (
    <SignIn
      fallbackRedirectUrl="/dashboard"
      forceRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/onboarding"
    />
  )
}
