"use client"

import { useUser } from "@clerk/nextjs"
import { useActiveWorkspace } from "@/lib/use-active-workspace"
import { HistoricalRelationshipEvidence } from "@/features/reports/historical-relationship-evidence"

export default function SavedEvidencePage() {
  const { user, isLoaded } = useUser()
  const { activeWorkspaceId } = useActiveWorkspace(user?.id)
  if (!isLoaded) return <p role="status">Loading workspace...</p>
  if (!user?.id) return <p role="status">Sign in to view saved evidence.</p>
  return <HistoricalRelationshipEvidence key={`${user.id}:${activeWorkspaceId}`} userId={user.id} workspaceId={activeWorkspaceId} />
}
