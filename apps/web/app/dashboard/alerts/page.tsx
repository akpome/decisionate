"use client"

import { useUser } from "@clerk/nextjs"
import { useActiveWorkspace } from "@/lib/use-active-workspace"
import { useWorkspaceAccess } from "@/lib/use-workspace-access"
import { WeeklyEmailSettings } from "@/features/alerts/weekly-email-settings"

export default function AlertsPage() {
  const { user, isLoaded } = useUser()
  const { activeWorkspaceId, workspaceVersion } = useActiveWorkspace(user?.id)
  const { canManageAlerts, loadingWorkspaceAccess } = useWorkspaceAccess(user?.id)

  return <div className="min-w-0 space-y-6">
    <header className="border-b border-gray-200 pb-4"><h1 className="text-2xl font-semibold">Scheduled weekly email</h1></header>
    {!isLoaded || loadingWorkspaceAccess ? <p role="status" className="text-sm text-gray-600">Checking workspace access...</p>
      : !user ? <p role="alert">Sign in to manage scheduled email.</p>
        : !canManageAlerts ? <p role="status" className="text-sm text-gray-600">Only the workspace owner or an approved agency owner can manage scheduled email.</p>
          : <WeeklyEmailSettings key={`${user.id}:${activeWorkspaceId}:${workspaceVersion}`} userId={user.id} workspaceId={activeWorkspaceId} />}
  </div>
}
