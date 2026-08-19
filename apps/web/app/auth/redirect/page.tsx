"use client"

import { useClerk, useUser } from "@clerk/nextjs"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { LogOut } from "lucide-react"

import {
  getMyOrganization,
  getOrganizationWorkspaces,
  getPlatformAdminAccess,
} from "@/lib/api"

export default function AuthRedirectPage() {
  const router = useRouter()
  const { isLoaded, isSignedIn, user } = useUser()
  const { signOut } = useClerk()
  const userPrimaryEmail =
    user?.primaryEmailAddress?.emailAddress
  const userFallbackEmail =
    user?.emailAddresses?.[0]?.emailAddress

  useEffect(() => {
    if (!isLoaded) {
      return
    }

    if (!isSignedIn || !user?.id) {
      router.replace("/sign-in")
      return
    }

    const authenticatedUserId = user.id

    let cancelled = false

    async function routeAuthenticatedUser() {
      const userEmail =
        userPrimaryEmail ?? userFallbackEmail

      const [adminResult, organizationResult, workspaceResult] =
        await Promise.allSettled([
          getPlatformAdminAccess(authenticatedUserId),
          getMyOrganization(authenticatedUserId),
          getOrganizationWorkspaces(authenticatedUserId, userEmail),
        ])

      if (cancelled) return

      if (
        adminResult.status === "fulfilled" &&
        adminResult.value
      ) {
        router.replace("/platform-admin")
        return
      }

      const workspaceLookupSucceeded =
        organizationResult.status === "fulfilled" &&
        workspaceResult.status === "fulfilled"
      const hasWorkspace =
        (organizationResult.status === "fulfilled" &&
          Boolean(organizationResult.value)) ||
        (workspaceResult.status === "fulfilled" &&
          workspaceResult.value.length > 0)

      if (workspaceLookupSucceeded && !hasWorkspace) {
        router.replace("/onboarding")
        return
      }

      // Preserve access for existing users when a non-auth lookup is
      // temporarily unavailable. DashboardShell will retry its workspace
      // loading and apply subscription access after the workspace is known.
      router.replace("/dashboard")
    }

    void routeAuthenticatedUser().catch(() => {
      if (!cancelled) {
        router.replace("/dashboard")
      }
    })

    return () => {
      cancelled = true
    }
  }, [
    isLoaded,
    isSignedIn,
    router,
    user?.id,
    userFallbackEmail,
    userPrimaryEmail,
  ])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50 px-6">
      <p
        role="status"
        aria-live="polite"
        className="text-sm text-gray-600"
      >
        Opening your workspace...
      </p>
      {isLoaded && isSignedIn && (
        <button
          type="button"
          onClick={() => void signOut({ redirectUrl: "/sign-in" })}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
        >
          <LogOut size={16} aria-hidden="true" />
          Switch account
        </button>
      )}
    </main>
  )
}
