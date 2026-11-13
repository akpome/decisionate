"use client"

import { useClerk, useUser } from "@clerk/nextjs"
import { LoaderCircle, LogOut } from "lucide-react"
import Link from "next/link"
import { useState, type ReactNode } from "react"

import { useDecisionateText } from "@/app/use-decisionate-language"
import { getSignInUrl, getSignUpUrl } from "../lib/auth-redirects"

export function WorkspaceInvitationSignIn({ returnTo, children }: { returnTo: string | null; children: ReactNode }) {
  const { isLoaded, isSignedIn, user } = useUser()
  const { signOut } = useClerk()
  const { t } = useDecisionateText()
  const [switching, setSwitching] = useState(false)
  const [failed, setFailed] = useState(false)

  async function handleSwitchAccount() {
    if (switching) return
    setSwitching(true)
    setFailed(false)
    try {
      await signOut({ redirectUrl: getSignInUrl(returnTo) })
    } catch {
      setFailed(true)
      setSwitching(false)
    }
  }

  if (!isLoaded) {
    return <p role="status" className="inline-flex min-h-24 items-center gap-2 text-sm text-gray-600"><LoaderCircle size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />{t("Loading sign in...")}</p>
  }
  if (!isSignedIn) return <>{children}<p className="mt-6 text-center text-sm text-gray-600">{t("New to Decisionate?")}{" "}<Link href={getSignUpUrl(returnTo)} className="font-semibold text-[var(--decisionate-brand-primary-text)] underline underline-offset-4">{t("Create an account")}</Link></p></>

  return (
    <section aria-labelledby="invitation-account-title" className="w-full rounded-lg border border-gray-200 bg-white p-5 sm:p-6">
      <h2 id="invitation-account-title" className="text-lg font-semibold text-gray-950">{t("Use the invited account")}</h2>
      <p className="mt-3 text-sm leading-6 text-gray-600">{t("This account cannot open the invited workspace. Sign in with the email address that received the invitation.")}</p>
      {user?.primaryEmailAddress?.emailAddress && <p className="mt-3 break-all text-sm text-gray-700">{user.primaryEmailAddress.emailAddress}</p>}
      <button type="button" onClick={() => void handleSwitchAccount()} disabled={switching} aria-busy={switching}
        className="mt-5 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--decisionate-brand-primary)] px-4 py-2 text-sm font-semibold text-[var(--decisionate-brand-primary-surface-text)] disabled:cursor-wait disabled:opacity-60">
        <LogOut size={16} aria-hidden="true" />{t(switching ? "Signing out..." : "Use invited account")}
      </button>
      {failed && <p role="alert" className="mt-3 text-sm text-red-600">{t("We could not switch accounts. Please try again.")}</p>}
    </section>
  )
}
