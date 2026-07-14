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

  useEffect(() => {
    let ignoreResult = false

    async function loadWorkspaceAccess() {
      if (!userId) {
        if (!ignoreResult) {
          setWorkspaces([])
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
        }
      } catch (error) {
        console.error(error)

        if (!ignoreResult) {
          setWorkspaces([])
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
    userId,
    workspaceVersion,
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

  const workspaceRole: WorkspaceRole =
    activeWorkspace
      ? normalizeWorkspaceRole(
        activeWorkspace.role
      )
      : activeWorkspaceId &&
          userId &&
          activeWorkspaceId !== userId
        ? "unknown"
        : "owner"

  return {
    activeWorkspace,
    activeWorkspaceId,
    canManageWorkspaceData:
      !loadingWorkspaceAccess &&
      workspaceRole !== "client" &&
      workspaceRole !== "unknown",
    isClientWorkspace:
      workspaceRole === "client",
    loadingWorkspaceAccess,
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
