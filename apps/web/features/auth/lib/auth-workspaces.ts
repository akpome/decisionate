import type { OrganizationWorkspaceRecord } from "@/lib/api"
import { getDashboardReturnTo, getOnboardingUrl, getSafeReturnTo } from "./auth-redirects"

export function isClientWorkspaceRole(role: string) {
  return ["client", "client_owner", "client_user"].includes(role.toLowerCase())
}

export function chooseAuthWorkspace(
  workspaces: OrganizationWorkspaceRecord[],
  userId: string,
  activeWorkspaceId: string,
  requestedWorkspaceId?: string | null,
) {
  const accessible = workspaces.filter(workspace =>
    workspace.role !== "managed_client" || workspace.agency_owner_access_enabled === true
  )
  if (requestedWorkspaceId) return accessible.find(workspace => workspace.owner_user_id === requestedWorkspaceId)
  const selected = accessible.find(workspace => workspace.owner_user_id === activeWorkspaceId)
  if (selected?.portal_origin && !selected.agency_removed) return selected
  const hosted = accessible.find(workspace => workspace.portal_origin && !workspace.agency_removed)
  if (hosted) return hosted
  if (activeWorkspaceId === userId) {
    const client = accessible.find(workspace => isClientWorkspaceRole(workspace.role) || workspace.agency_removed)
    if (client) return client
  }
  return selected
    ?? accessible.find(workspace => workspace.owner_user_id === userId)
    ?? accessible[0]
}

export function getAuthenticatedDestination(
  isAdmin: boolean,
  workspace: OrganizationWorkspaceRecord | undefined,
  value?: string | null,
) {
  const returnTo = getSafeReturnTo(value)
  const dashboardReturnTo = getDashboardReturnTo(returnTo)
  if (isAdmin && !dashboardReturnTo) {
    return returnTo?.startsWith("/platform-admin") ? returnTo : "/platform-admin"
  }
  if (!workspace) {
    return getOnboardingUrl(dashboardReturnTo)
  }
  return dashboardReturnTo ?? "/dashboard"
}
