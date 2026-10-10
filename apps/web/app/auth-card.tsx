"use client"

import { ClerkAuthCard } from "./clerk-auth-card"

type AuthCardProps = {
  mode: "sign-in" | "sign-up"
  returnTo?: string | null
}

export function AuthCard({
  mode,
  returnTo,
}: AuthCardProps) {
  return (
    <ClerkAuthCard
      mode={mode}
      returnTo={returnTo}
    />
  )
}
