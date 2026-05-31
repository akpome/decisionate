"use client"

import { useUser } from "@clerk/nextjs"

export function useCurrentUser() {
  const { user, isLoaded, isSignedIn } = useUser()

  return {
    user,
    isLoaded,
    isSignedIn,
  }
}