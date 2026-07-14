/* =========================
   Browser Workspace Selection Storage For Agency And Client Switching
========================= */

export type ActiveWorkspaceChange = {
  workspaceId: string
}

export const activeWorkspaceChangedEvent =
  "decisionate:active-workspace-changed"

function cleanWorkspaceId(
  workspaceId: string | null | undefined,
  fallback: string
) {
  return workspaceId?.trim() || fallback
}

function getActiveWorkspaceStorageKey(
  userId: string
) {
  return `decisionate:active-workspace-id:${userId}`
}

export function getActiveWorkspaceId(
  userId: string
) {
  const cleanUserId =
    userId.trim()

  if (typeof window === "undefined") {
    return cleanUserId
  }

  return cleanWorkspaceId(
    window.localStorage.getItem(
      getActiveWorkspaceStorageKey(cleanUserId)
    ),
    cleanUserId
  )
}

export function setActiveWorkspaceId(
  userId: string,
  workspaceId: string
) {
  const cleanUserId =
    userId.trim()
  const cleanWorkspaceId =
    workspaceId.trim() || cleanUserId

  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(
    getActiveWorkspaceStorageKey(cleanUserId),
    cleanWorkspaceId
  )

  window.dispatchEvent(
    new CustomEvent<ActiveWorkspaceChange>(
      activeWorkspaceChangedEvent,
      {
        detail: {
          workspaceId: cleanWorkspaceId,
        },
      }
    )
  )
}
