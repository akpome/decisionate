"use client"

import { useUser } from "@clerk/nextjs"
import { useActiveWorkspace } from "@/lib/use-active-workspace"
import { useWorkspaceAccess } from "@/lib/use-workspace-access"
import { ReportWorkspace } from "@/features/reports/report-workspace"

export default function ReportPage({ scope = "multi", weekly = false }: { scope?: "single" | "multi"; weekly?: boolean }) {
  const { user, isLoaded } = useUser()
  const { activeWorkspaceId } = useActiveWorkspace(user?.id)
  const access = useWorkspaceAccess(user?.id)
  if (!isLoaded || access.loadingWorkspaceAccess) return <p role="status">Loading workspace...</p>
  if (!user?.id) return <p role="status">Sign in to view reports.</p>
  return <ReportWorkspace key={`${user.id}:${activeWorkspaceId}:${scope}:${weekly}`} initialScope={scope} weekly={weekly} userId={user.id} workspaceId={activeWorkspaceId}
    canManage={access.canManageWorkspaceData} canSave={access.canManageWorkspaceData || access.canCreateDecisions}
    canEditDecisions={access.canCreateDecisions} />
}
