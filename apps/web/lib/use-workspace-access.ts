"use client"

import {
  useEffect,
  useMemo,
  useState,
} from "react"
import { useUser } from "@clerk/nextjs"

import {
  getOrganizationWorkspaces,
  type OrganizationWorkspaceRecord,
} from "@/lib/api"
import {
  useActiveWorkspace,
} from "@/lib/use-active-workspace"
import {
  setActiveWorkspaceId,
  workspaceAccessChangedEvent,
} from "@/lib/workspace-context"

export type WorkspaceRole =
  | "owner"
  | "member"
  | "client"
  | "managed_client"
  | "unknown"

export function useWorkspaceAccess(
  userId: string | undefined
) {
  const { user } = useUser()
  const userEmail = user?.primaryEmailAddress?.emailAddress
  const {
    activeWorkspaceId,
    workspaceVersion,
  } = useActiveWorkspace(userId)
  const [workspaces, setWorkspaces] =
    useState<OrganizationWorkspaceRecord[]>([])
  const [loadingWorkspaceAccess, setLoadingWorkspaceAccess] =
    useState(true)
  const workspaceAccessKey =
    `${userId ?? ""}:${activeWorkspaceId}`
  const [loadedWorkspaceAccessKey, setLoadedWorkspaceAccessKey] =
    useState("")
  const [accessRefreshKey, setAccessRefreshKey] =
    useState(0)

  useEffect(() => {
    const handleWorkspaceAccessChanged = () => {
      setAccessRefreshKey(
        currentKey => currentKey + 1
      )
    }

    window.addEventListener(
      workspaceAccessChangedEvent,
      handleWorkspaceAccessChanged
    )

    return () => {
      window.removeEventListener(
        workspaceAccessChangedEvent,
        handleWorkspaceAccessChanged
      )
    }
  }, [])

  useEffect(() => {
    let ignoreResult = false

    async function loadWorkspaceAccess() {
      if (!userId) {
        if (!ignoreResult) {
          setWorkspaces([])
          setLoadedWorkspaceAccessKey(workspaceAccessKey)
          setLoadingWorkspaceAccess(false)
        }

        return
      }

      setLoadingWorkspaceAccess(true)

      try {
        const workspaceData =
          await getOrganizationWorkspaces(
            userId,
            userEmail,
            {
              includeManagedClientWorkspaces: true,
            }
          )

        const selectableWorkspaces =
          workspaceData.filter(
            workspace =>
              workspace.role.toLowerCase() !==
                "managed_client" ||
              workspace.agency_owner_access_enabled === true
          )

        if (
          !ignoreResult &&
          activeWorkspaceId !== userId &&
          !selectableWorkspaces.some(
            workspace =>
              workspace.owner_user_id ===
              activeWorkspaceId
          )
        ) {
          setActiveWorkspaceId(
            userId,
            userId
          )
        }

        if (!ignoreResult) {
          setWorkspaces(selectableWorkspaces)
          setLoadedWorkspaceAccessKey(workspaceAccessKey)
        }
      } catch (error) {
        console.error(error)

        if (!ignoreResult) {
          setWorkspaces([])
          setLoadedWorkspaceAccessKey(workspaceAccessKey)
        }
      } finally {
        if (!ignoreResult) {
          setLoadingWorkspaceAccess(false)
        }
      }
    }

    void loadWorkspaceAccess()

    return () => {
      ignoreResult = true
    }
  }, [
    accessRefreshKey,
    workspaceAccessKey,
    activeWorkspaceId,
    userId,
    userEmail,
  ])

  const activeWorkspace =
    useMemo(
      () =>
        activeWorkspaceId && userId
          ? workspaces.find(
            (workspace) =>
              workspace.owner_user_id ===
              activeWorkspaceId
          ) ?? null
          : null,
      [
        activeWorkspaceId,
        userId,
        workspaces,
      ]
    )

  const workspaceRoleFromData: WorkspaceRole =
    activeWorkspace
      ? normalizeWorkspaceRole(
        activeWorkspace.role
      )
      : "unknown"
  const workspaceAccessReady =
    loadedWorkspaceAccessKey === workspaceAccessKey
  const workspaceRole: WorkspaceRole =
    workspaceAccessReady
      ? workspaceRoleFromData
      : "unknown"
  const isAgencyWorkspace =
    Boolean(activeWorkspace) &&
    !activeWorkspace?.owner_user_id.includes(":client:")
  const hasOwnerWorkspaceMembership =
    workspaceRoleFromData === "owner" &&
    isAgencyWorkspace
  const canConfigureWorkspace =
    workspaceAccessReady &&
    !loadingWorkspaceAccess &&
    workspaceRole === "owner" &&
    hasOwnerWorkspaceMembership
  const verifiedOwnerWorkspace =
    workspaceRole === "owner" &&
    hasOwnerWorkspaceMembership

  return {
    activeWorkspace,
    activeWorkspaceId,
    canManageAlerts:
      workspaceAccessReady &&
      !loadingWorkspaceAccess &&
      (workspaceRole === "owner" ||
        workspaceRole === "client" ||
        workspaceRole === "managed_client"),
    canConfigureWorkspace,
    canDeleteDecisions:
      workspaceAccessReady &&
      !loadingWorkspaceAccess &&
      (workspaceRole === "client" ||
        verifiedOwnerWorkspace),
    canViewConnections:
      workspaceAccessReady &&
      !loadingWorkspaceAccess &&
      (workspaceRole === "client" ||
        verifiedOwnerWorkspace),
    canManageWorkspaceData:
      workspaceAccessReady &&
      !loadingWorkspaceAccess &&
      (workspaceRole === "client" ||
        verifiedOwnerWorkspace),
    canCreateDecisions:
      workspaceAccessReady &&
      !loadingWorkspaceAccess &&
      (workspaceRole === "owner" ||
        workspaceRole === "member" ||
        workspaceRole === "managed_client"),
    isClientWorkspace:
      workspaceRole === "client",
    loadingWorkspaceAccess,
    workspaceAccessReady,
    workspaceRole,
    workspaceVersion,
  }
}

function normalizeWorkspaceRole(
  role: string
): WorkspaceRole {
  const cleanRole =
    role.trim().toLowerCase()

  if (
    cleanRole === "owner" ||
    cleanRole === "member" ||
    cleanRole === "client" ||
    cleanRole === "managed_client"
  ) {
    return cleanRole
  }

  return "unknown"
}
