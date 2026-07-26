"use client"

import { useEffect } from "react"
import { RuntimeErrorState } from "@/features/dashboard/components/runtime-error-state"

export default function DashboardError({
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
      title="Dashboard unavailable"
      description="Something went wrong while loading this dashboard. Try again, or return to the dashboard home."
      homeHref="/dashboard"
      homeLabel="Dashboard home"
      errorDigest={error.digest}
      reset={reset}
    />
  )
}
