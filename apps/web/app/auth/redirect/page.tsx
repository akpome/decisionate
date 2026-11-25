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
import { getAuthRedirectUrl, getDashboardReturnTo, getInvitedWorkspaceId, getSafeReturnTo, getSignInUrl, getWorkspaceAccountSwitchUrl } from "@/features/auth/lib/auth-redirects"
import { chooseAuthWorkspace, getAuthenticatedDestination } from "@/features/auth/lib/auth-workspaces"
import { writeSignupConsent } from "@/features/auth/lib/signup-consent"
import { completeSignupMarketing } from "@/features/auth/lib/marketing-consent"
import { getActiveWorkspaceId, setActiveWorkspaceId } from "@/lib/workspace-context"
import { useDecisionateText } from "@/app/use-decisionate-language"
import { useHostedPortal } from "@/features/hosted-subdomains/provider"
import { getHostedAuthUrl, hostedWorkspaceRecoveryUrl } from "@/features/hosted-subdomains/types"

const redirectErrors = {
  session: ["Your session could not be verified.", "Sign in again to continue."],
  access: ["Workspace access was denied.", "Try another account or contact support if you believe you should have access."],
  portal: ["No workspace on this portal", "Sign in with the email invited to this workspace, or open your workspace directly."],
  portalSession: ["This portal couldn't finish signing you in.", "Try again. If the problem continues, contact your workspace owner."],
  workspace: ["We couldn't open your workspace.", "Your account is signed in, but the workspace service is unavailable. Please try again."],
} as const

export default function AuthRedirectPage() {
  const router = useRouter()
  const { isLoaded, isSignedIn, user } = useUser()
  const { signOut } = useClerk()
  const { t } = useDecisionateText()
  const { portal } = useHostedPortal()
  const [attempt, setAttempt] = useState(0)
  const [routingError, setError] = useState<keyof typeof redirectErrors | null>(null)
  const error = portal && isLoaded && (!isSignedIn || !user?.id) ? "portalSession" : routingError
  const [switching, setSwitching] = useState(false)
  const [switchFailed, setSwitchFailed] = useState(false)
  const userPrimaryEmail =
    user?.primaryEmailAddress?.emailAddress
  const userFallbackEmail =
    user?.emailAddresses?.[0]?.emailAddress
  const userCreatedAt = user?.createdAt?.getTime() ?? null

  async function switchAccount() {
    if (switching) return
    setSwitching(true)
    setSwitchFailed(false)
    const returnTo = getSafeReturnTo(new URLSearchParams(window.location.search).get("redirect_url"), window.location.origin)
    try {
      await signOut({ redirectUrl: getSignInUrl(returnTo) })
    } catch {
      setSwitchFailed(true)
      setSwitching(false)
    }
  }

  useEffect(() => {
    if (!isLoaded) {
      return
    }

    const requestedRedirect =
      new URLSearchParams(window.location.search).get(
        "redirect_url"
      )
    const returnTo = getSafeReturnTo(requestedRedirect, window.location.origin)
    const requestedWorkspaceId = getInvitedWorkspaceId(returnTo)

    if (!isSignedIn || !user?.id) {
      if (!portal) router.replace(getSignInUrl(returnTo))
      return
    }

    const authenticatedUserId = user.id

    let cancelled = false

    async function routeAuthenticatedUser() {
      setError(null)
      writeSignupConsent(false)
      if (!portal) void completeSignupMarketing(authenticatedUserId, userCreatedAt)
      const userEmail =
        userPrimaryEmail ?? userFallbackEmail

      const [adminResult, workspaceResult] =
        await Promise.allSettled([
          portal ? Promise.resolve(false) : getPlatformAdminAccess(authenticatedUserId),
          getOrganizationWorkspaces(authenticatedUserId, userEmail, {
            forceRefresh: Boolean(requestedWorkspaceId) || attempt > 0,
          }),
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
      const workspace = chooseAuthWorkspace(workspaceResult.value, authenticatedUserId, getActiveWorkspaceId(authenticatedUserId), requestedWorkspaceId)
      if (requestedWorkspaceId && !workspace) {
        router.replace(getWorkspaceAccountSwitchUrl(returnTo))
        return
      }
      if (portal && !workspace) {
        setError("portal")
        return
      }
      if (adminResult.status === "rejected" && (!workspace || returnTo?.startsWith("/platform-admin"))) {
        throw adminResult.reason
      }
      if (workspace) setActiveWorkspaceId(authenticatedUserId, workspace.owner_user_id)
      router.replace(getAuthenticatedDestination(isAdmin, workspace, returnTo))
    }

    void routeAuthenticatedUser().catch((failure: unknown) => {
      if (!cancelled) {
        if (requestedWorkspaceId && failure instanceof ApiError && failure.status === 403) {
          router.replace(getWorkspaceAccountSwitchUrl(returnTo))
          return
        }
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
    userCreatedAt,
    attempt,
    portal,
  ])

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-6 py-10">
      <div className="w-full max-w-md text-center">
        <h1 className="text-xl font-semibold text-gray-950">{portal?.branding?.name || "Decisionate"}</h1>
        {error ? (
          <div role="alert" className="mt-4 space-y-2">
            <p className="font-medium text-gray-950">{t(redirectErrors[error][0])}</p>
            <p className="text-sm leading-6 text-gray-600">{t(redirectErrors[error][1])}</p>
          </div>
        ) : (
          <p role="status" aria-live="polite" className="mt-4 inline-flex items-center gap-2 text-sm text-gray-600">
            <LoaderCircle size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {t("Opening your workspace...")}
          </p>
        )}
        {error && userPrimaryEmail && <p className="mt-3 break-all text-xs text-gray-500">{userPrimaryEmail}</p>}
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {error === "portal" && <a href={hostedWorkspaceRecoveryUrl} className="inline-flex min-h-10 items-center rounded-md bg-[var(--decisionate-brand-primary)] px-4 py-2 text-sm font-semibold text-[var(--decisionate-brand-primary-surface-text)]">{t("Open my workspace")}</a>}
          {error === "portalSession" && portal && (
            <button type="button" onClick={() => {
              const returnTo = getSafeReturnTo(new URLSearchParams(window.location.search).get("redirect_url"), portal.origin)
              window.location.replace(getHostedAuthUrl("sign-in", portal.origin + getAuthRedirectUrl(returnTo)))
            }} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-[var(--decisionate-brand-primary)] px-4 py-2 text-sm font-semibold text-[var(--decisionate-brand-primary-surface-text)]">
              <RefreshCw size={16} aria-hidden="true" />{t("Try sign-in again")}
            </button>
          )}
          {(error === "workspace" || error === "access") && (
            <button type="button" disabled={switching} onClick={() => setAttempt(value => value + 1)} className="inline-flex items-center gap-2 rounded-lg bg-[var(--decisionate-brand-primary)] px-4 py-2 text-sm font-semibold text-[var(--decisionate-brand-primary-surface-text)] disabled:opacity-60">
              <RefreshCw size={16} aria-hidden="true" />{t("Try again")}
            </button>
          )}
          {error && isLoaded && isSignedIn && (
            <button type="button" onClick={() => void switchAccount()} disabled={switching} aria-busy={switching} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60">
              <LogOut size={16} aria-hidden="true" />{t(switching ? "Signing out..." : error === "session" ? "Sign in again" : "Switch account")}
            </button>
          )}
        </div>
        {switchFailed && <p role="alert" className="mt-3 text-sm text-red-600">{t("We could not switch accounts. Please try again.")}</p>}
      </div>
    </main>
  )
}
