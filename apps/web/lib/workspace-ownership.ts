import type { OrganizationWorkspaceRecord } from "./api"

export function isAgencyManagedWorkspace(workspace: OrganizationWorkspaceRecord | null | undefined) {
  return workspace?.is_managed_client ?? Boolean(workspace?.owner_user_id.includes(":client:"))
}
