"use client"

import {
  useSyncExternalStore,
} from "react"

import {
  activeWorkspaceChangedEvent,
  getActiveWorkspaceId,
} from "@/lib/workspace-context"

/* =========================
   Active Workspace React Hook For Refetching Pages Without Full Reloads
========================= */

export function useActiveWorkspace(
  userId: string | undefined
) {
  const activeWorkspaceId =
    useSyncExternalStore(
      subscribeToWorkspaceChanges,
      () => getWorkspaceSnapshot(userId),
      () => userId ?? ""
    )

  return {
    activeWorkspaceId,
    workspaceVersion: activeWorkspaceId,
  }
}

function subscribeToWorkspaceChanges(
  onStoreChange: () => void
) {
  window.addEventListener(
    activeWorkspaceChangedEvent,
    onStoreChange
  )

  return () => {
    window.removeEventListener(
      activeWorkspaceChangedEvent,
      onStoreChange
    )
  }
}

function getWorkspaceSnapshot(
  userId: string | undefined
) {
  return userId
    ? getActiveWorkspaceId(userId)
    : ""
}
