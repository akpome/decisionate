"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { hostedPortalRequest, hostedSubdomainRequest } from "@/lib/api"
import { useHostedPortal } from "@/features/hosted-subdomains/provider"
import { useActiveWorkspace } from "@/lib/use-active-workspace"

export function WhiteLabelSettingsLink({ userId, plan }: { userId: string; plan: string }) {
  const { portal } = useHostedPortal()
  const { activeWorkspaceId } = useActiveWorkspace(userId)
  if (portal || !["agency", "agency_subdomain", "agency_custom_domain"].includes(plan)) return null
  return <div className="flex flex-wrap gap-4"><HostedSettingsLink key={activeWorkspaceId} userId={userId} />{plan === "agency_custom_domain" && activeWorkspaceId === userId && <CustomSettingsLink userId={userId} />}</div>
}

function HostedSettingsLink({ userId }: { userId: string }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void hostedSubdomainRequest<{ commercially_available: boolean; portal: unknown }>(userId, "", { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setVisible(value.commercially_available || Boolean(value.portal)) })
      .catch(() => { if (!controller.signal.aborted) setVisible(false) })
    return () => controller.abort()
  }, [userId])
  return visible ? <Link href="/hosted-portal" className="text-sm font-medium text-blue-700 underline underline-offset-4">Hosted portal</Link> : null
}

function CustomSettingsLink({ userId }: { userId: string }) {
  const [state, setState] = useState<{ commercially_available: boolean; portal: { status: string } | null } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void hostedPortalRequest<{ commercially_available: boolean; portal: { status: string } | null }>(userId, "", { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setState(value) })
      .catch(() => { if (!controller.signal.aborted) setState(null) })
    return () => controller.abort()
  }, [userId])
  if (!state?.commercially_available) return null
  return <Link href="/white-label" className="text-sm font-medium text-blue-700 underline underline-offset-4">
    {state.portal ? "Manage custom-domain portal" : "Set up a custom-domain portal"}
  </Link>
}
