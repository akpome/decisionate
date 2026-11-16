import { DashboardShell } from "./dashboard-shell"
import { MarketingActivityTracker } from "@/features/marketing/activity-tracker"
import type { Metadata } from "next"
import { headers } from "next/headers"
import { getAuthRequestOrigin } from "@/features/auth/lib/auth-redirects"
import { isDecisionatePwaHost } from "@/lib/decisionate-domains"
import { portalBrand } from "@/lib/portal-brand"

export async function generateMetadata(): Promise<Metadata> {
  const hostname = new URL(getAuthRequestOrigin(await headers())).hostname
  const enabled = !portalBrand.id && isDecisionatePwaHost(hostname)
  return {
    robots: { index: false, follow: false },
    manifest: enabled ? "/manifest.webmanifest" : undefined,
    appleWebApp: enabled || portalBrand.id ? {
      capable: true,
      title: portalBrand.name,
      statusBarStyle: "default",
    } : undefined,
  }
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <DashboardShell>
      <MarketingActivityTracker />
      {children}
    </DashboardShell>
  )
}
