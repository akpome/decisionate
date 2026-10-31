"use client"

import { useUser } from "@clerk/nextjs"
import { useActiveWorkspace } from "@/lib/use-active-workspace"
import { useWorkspaceAccess } from "@/lib/use-workspace-access"
import { PerformanceWorkspace } from "./performance-workspace"
import type { ToolKind } from "./types"

export default function PerformancePage({ kind }: { kind: ToolKind }) {
  const { user, isLoaded } = useUser()
  const { activeWorkspaceId } = useActiveWorkspace(user?.id)
  const access = useWorkspaceAccess(user?.id)
  if (!isLoaded || access.loadingWorkspaceAccess) return <p role="status">Loading workspace...</p>
  if (!user?.id) return <p role="status">Sign in to view analyses.</p>
  return <PerformanceWorkspace key={`${user.id}:${activeWorkspaceId}:${kind}`} kind={kind} userId={user.id} workspaceId={activeWorkspaceId}
    canSave={access.canManageWorkspaceData || access.canCreateDecisions} canManage={access.canManageWorkspaceData} canDecide={access.canCreateDecisions} />
}
