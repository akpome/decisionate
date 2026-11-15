"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { hostedPortalRequest } from "@/lib/api"

export function WhiteLabelSettingsLink({ userId }: { userId: string }) {
  const [state, setState] = useState<{ commercially_available: boolean; portal: { status: string } | null } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void hostedPortalRequest<{ commercially_available: boolean; portal: { status: string } | null }>(userId, "", { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setState(value) })
      .catch(() => { if (!controller.signal.aborted) setState(null) })
    return () => controller.abort()
  }, [userId])
  if (!state || (!state.commercially_available && !state.portal)) return null
  return <Link href="/white-label" className="text-sm font-medium text-blue-700 underline underline-offset-4">
    {state.portal ? "Manage custom-domain portal" : "Set up a custom-domain portal"}
  </Link>
}
