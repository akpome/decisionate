"use client"

import { ClerkAuthCard } from "./clerk-auth-card"

type AuthCardProps = {
  mode: "sign-in" | "sign-up"
}

export function AuthCard({
  mode,
}: AuthCardProps) {
  return <ClerkAuthCard mode={mode} />
}
