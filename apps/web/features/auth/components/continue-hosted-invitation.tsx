"use client"

import { useClerk } from "@clerk/nextjs"
import { ArrowRight } from "lucide-react"
import { useState } from "react"
import { useDecisionateText } from "@/app/use-decisionate-language"

export function ContinueHostedInvitation({ mode, hostedReturn, sessionId }: {
  mode: "sign-in" | "sign-up"; hostedReturn: string; sessionId: string
}) {
  const { signOut } = useClerk()
  const { t } = useDecisionateText()
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  async function continueWithInvitation() {
    if (pending) return
    setPending(true)
    setFailed(false)
    try {
      await signOut({ sessionId, redirectUrl: `/${mode}?redirect_url=${encodeURIComponent(hostedReturn)}` })
    } catch {
      setPending(false)
      setFailed(true)
    }
  }

  return (
    <div className="space-y-3">
      <button type="button" onClick={() => void continueWithInvitation()} disabled={pending} aria-busy={pending}
        className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--decisionate-brand-primary)] px-4 py-2 text-sm font-semibold text-[var(--decisionate-brand-primary-surface-text)] disabled:opacity-60">
        {t(pending ? "Opening invitation..." : mode === "sign-up" ? "Continue to sign up" : "Continue to sign in")}
        <ArrowRight size={16} aria-hidden="true" />
      </button>
      <p className="text-sm text-gray-600">{t("Continuing signs out the current account in this browser.")}</p>
      {failed && <p role="alert" className="text-sm text-red-600">{t("We couldn't open the sign-in form. Please try again.")}</p>}
    </div>
  )
}
