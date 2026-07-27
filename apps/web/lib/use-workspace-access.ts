"use client"

import {
  useEffect,
  useMemo,
  useState,
} from "react"

import {
  getOrganizationWorkspaces,
  type OrganizationWorkspaceRecord,
} from "@/lib/api"
import {
  useActiveWorkspace,
} from "@/lib/use-active-workspace"
import {
  workspaceAccessChangedEvent,
} from "@/lib/workspace-context"

export type WorkspaceRole =
  | "owner"
  | "member"
  | "client"
  | "unknown"

export function useWorkspaceAccess(
  userId: string | undefined
) {
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
            userId
          )

        if (!ignoreResult) {
          setWorkspaces(workspaceData)
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
    userId,
  ])

  const activeWorkspace =
    useMemo(
      () =>
        activeWorkspaceId &&
        userId &&
        activeWorkspaceId !== userId
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
      : activeWorkspaceId &&
          userId &&
          activeWorkspaceId !== userId
        ? "unknown"
        : "owner"
  const workspaceAccessReady =
    loadedWorkspaceAccessKey === workspaceAccessKey
  const workspaceRole: WorkspaceRole =
    workspaceAccessReady
      ? workspaceRoleFromData
      : "unknown"
  const canConfigureWorkspace =
    workspaceAccessReady &&
    !loadingWorkspaceAccess &&
    workspaceRole === "owner"

  return {
    activeWorkspace,
    activeWorkspaceId,
    canConfigureWorkspace,
    canManageWorkspaceData:
      workspaceAccessReady &&
      !loadingWorkspaceAccess &&
      workspaceRole !== "client" &&
      workspaceRole !== "unknown",
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
    cleanRole === "client"
  ) {
    return cleanRole
  }

  return "unknown"
}
