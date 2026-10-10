import type { OrganizationWorkspaceRecord } from "@/lib/api"
import { getDashboardReturnTo, getOnboardingUrl, getSafeReturnTo } from "./auth-redirects"

export function chooseAuthWorkspace(
  workspaces: OrganizationWorkspaceRecord[],
  userId: string,
  activeWorkspaceId: string,
) {
  const accessible = workspaces.filter(workspace =>
    workspace.role !== "managed_client" || workspace.agency_owner_access_enabled === true
  )
  return accessible.find(workspace => workspace.owner_user_id === activeWorkspaceId)
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
