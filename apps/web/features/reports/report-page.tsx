"use client"

import { useUser } from "@clerk/nextjs"
import { useWorkspaceAccess } from "@/lib/use-workspace-access"
import { ReportWorkspace } from "@/features/reports/report-workspace"

export default function ReportPage({ scope = "multi", weekly = false, impactPage = false, includeRelationships = true }: { scope?: "single" | "multi"; weekly?: boolean; impactPage?: boolean; includeRelationships?: boolean }) {
  const { user, isLoaded } = useUser()
  const access = useWorkspaceAccess(user?.id, { backgroundRefresh: true })
  const { activeWorkspaceId } = access
  if (!isLoaded || access.loadingWorkspaceAccess) return <p role="status">Loading workspace...</p>
  if (!user?.id) return <p role="status">Sign in to view reports.</p>
  return <ReportWorkspace key={`${user.id}:${activeWorkspaceId}:${scope}:${weekly}:${impactPage}:${includeRelationships}`} initialScope={scope} includeRelationships={includeRelationships} weekly={weekly} impactPage={impactPage} userId={user.id} workspaceId={activeWorkspaceId}
    canManage={access.canManageWorkspaceData} canManageEmail={access.canManageAlerts} canSave={access.canManageWorkspaceData || access.canCreateDecisions}
    canEditDecisions={access.canCreateDecisions} />
}
