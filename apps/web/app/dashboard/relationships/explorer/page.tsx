"use client"

import { useUser } from "@clerk/nextjs"
import { useActiveWorkspace } from "@/lib/use-active-workspace"
import { CorrelationExplorer } from "@/features/relationships/correlation-explorer"

export default function RelationshipExplorerPage() {
  const { user } = useUser()
  const { activeWorkspaceId } = useActiveWorkspace(user?.id)
  if (!user?.id) return <p role="status" className="text-sm text-gray-500">Loading workspace...</p>
  return <CorrelationExplorer key={`${user.id}:${activeWorkspaceId}`} userId={user.id} workspaceId={activeWorkspaceId} />
}
