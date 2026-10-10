"use client"

import { useClerk, useUser } from "@clerk/nextjs"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { LoaderCircle, LogOut, RefreshCw } from "lucide-react"

import {
  ApiError,
  getOrganizationWorkspaces,
  getPlatformAdminAccess,
} from "@/lib/api"
import { getDashboardReturnTo, getSafeReturnTo, getSignInUrl } from "@/features/auth/lib/auth-redirects"
import { chooseAuthWorkspace, getAuthenticatedDestination } from "@/features/auth/lib/auth-workspaces"
import { writeSignupConsent } from "@/features/auth/lib/signup-consent"
import { getActiveWorkspaceId, setActiveWorkspaceId } from "@/lib/workspace-context"
import { useDecisionateText } from "@/app/use-decisionate-language"

export default function AuthRedirectPage() {
  const router = useRouter()
  const { isLoaded, isSignedIn, user } = useUser()
  const { signOut } = useClerk()
  const { t } = useDecisionateText()
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState<"session" | "access" | "workspace" | null>(null)
  const userPrimaryEmail =
    user?.primaryEmailAddress?.emailAddress
  const userFallbackEmail =
    user?.emailAddresses?.[0]?.emailAddress

  useEffect(() => {
    if (!isLoaded) {
      return
    }

    const requestedRedirect =
      new URLSearchParams(window.location.search).get(
        "redirect_url"
      )
    const returnTo = getSafeReturnTo(requestedRedirect, window.location.origin)

    if (!isSignedIn || !user?.id) {
      router.replace(getSignInUrl(returnTo))
      return
    }

    const authenticatedUserId = user.id

    let cancelled = false

    async function routeAuthenticatedUser() {
      setError(null)
      writeSignupConsent(false)
      const userEmail =
        userPrimaryEmail ?? userFallbackEmail

      const [adminResult, workspaceResult] =
        await Promise.allSettled([
          getPlatformAdminAccess(authenticatedUserId),
          getOrganizationWorkspaces(authenticatedUserId, userEmail),
        ])

      if (cancelled) return

      const isAdmin = adminResult.status === "fulfilled" && adminResult.value
      if (isAdmin && !getDashboardReturnTo(returnTo)) {
        router.replace(getAuthenticatedDestination(true, undefined, returnTo))
        return
      }

      if (workspaceResult.status === "rejected") throw workspaceResult.reason
      if (adminResult.status === "rejected" && adminResult.reason instanceof ApiError && adminResult.reason.status === 401) {
        throw adminResult.reason
      }
      const workspace = chooseAuthWorkspace(workspaceResult.value, authenticatedUserId, getActiveWorkspaceId(authenticatedUserId))
      if (adminResult.status === "rejected" && (!workspace || returnTo?.startsWith("/platform-admin"))) {
        throw adminResult.reason
      }
      if (workspace) setActiveWorkspaceId(authenticatedUserId, workspace.owner_user_id)
      router.replace(getAuthenticatedDestination(isAdmin, workspace, returnTo))
    }

    void routeAuthenticatedUser().catch((failure: unknown) => {
      if (!cancelled) {
        setError(failure instanceof ApiError && failure.status === 401 ? "session" : failure instanceof ApiError && failure.status === 403 ? "access" : "workspace")
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
    attempt,
  ])

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-6 py-10">
      <div className="w-full max-w-md text-center">
        <h1 className="text-xl font-semibold text-gray-950">Decisionate</h1>
        {error ? (
          <div role="alert" className="mt-4 space-y-2">
            <p className="font-medium text-gray-950">{t(error === "session" ? "Your session could not be verified." : error === "access" ? "Workspace access was denied." : "We couldn't open your workspace.")}</p>
            <p className="text-sm leading-6 text-gray-600">{t(error === "session" ? "Sign in again to continue." : error === "access" ? "Try another account or contact support if you believe you should have access." : "Your account is signed in, but the workspace service is unavailable. Please try again.")}</p>
          </div>
        ) : (
          <p role="status" aria-live="polite" className="mt-4 inline-flex items-center gap-2 text-sm text-gray-600">
            <LoaderCircle size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {t("Opening your workspace...")}
          </p>
        )}
        {userPrimaryEmail && <p className="mt-3 break-all text-xs text-gray-500">{userPrimaryEmail}</p>}
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {(error === "workspace" || error === "access") && (
            <button type="button" onClick={() => setAttempt(value => value + 1)} className="inline-flex items-center gap-2 rounded-lg bg-[var(--decisionate-brand-primary)] px-4 py-2 text-sm font-semibold text-[var(--decisionate-brand-primary-surface-text)]">
              <RefreshCw size={16} aria-hidden="true" />{t("Try again")}
            </button>
          )}
          {isLoaded && isSignedIn && (
            <button type="button" onClick={() => void signOut({ redirectUrl: getSignInUrl(getSafeReturnTo(new URLSearchParams(window.location.search).get("redirect_url"), window.location.origin)) })} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50">
              <LogOut size={16} aria-hidden="true" />{t(error === "session" ? "Sign in again" : "Switch account")}
            </button>
          )}
        </div>
      </div>
    </main>
  )
}
