"use client"

import { ClerkAuthCard } from "./clerk-auth-card"

type AuthCardProps = {
  mode: "sign-in" | "sign-up"
  redirectUrl?: string
}

export function AuthCard({
  mode,
  redirectUrl,
}: AuthCardProps) {
  return (
    <ClerkAuthCard
      mode={mode}
      redirectUrl={redirectUrl}
    />
  )
}
