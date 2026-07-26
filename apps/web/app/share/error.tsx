"use client"

import { useEffect } from "react"
import { RuntimeErrorState } from "@/features/dashboard/components/runtime-error-state"

export default function ShareError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <RuntimeErrorState
      title="Shared dashboard unavailable"
      description="Something went wrong while loading this shared dashboard. Try again or return to the Decisionate home page."
      homeHref="/"
      homeLabel="Decisionate home"
      errorDigest={error.digest}
      reset={reset}
      mainClassName="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12"
    />
  )
}
