"use client"

import { useUser } from "@clerk/nextjs"
import { useActiveWorkspace } from "@/lib/use-active-workspace"
import { useWorkspaceAccess } from "@/lib/use-workspace-access"
import { BudgetPlanner } from "@/features/budget-planner/budget-planner"

export default function BudgetPlannerPage() {
  const { user, isLoaded } = useUser()
  const { activeWorkspaceId } = useActiveWorkspace(user?.id)
  const access = useWorkspaceAccess(user?.id)
  if (!isLoaded || access.loadingWorkspaceAccess) return <p role="status">Loading workspace...</p>
  if (!user) return <p role="status">Sign in to view budget plans.</p>
  return <BudgetPlanner key={`${user.id}:${activeWorkspaceId}`} userId={user.id} workspaceId={activeWorkspaceId}
    canSave={access.canManageWorkspaceData || access.canCreateDecisions} canDecide={access.canCreateDecisions} />
}
