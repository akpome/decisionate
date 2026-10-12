import { DashboardShell } from "./dashboard-shell"
import { MarketingActivityTracker } from "@/features/marketing/activity-tracker"

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
