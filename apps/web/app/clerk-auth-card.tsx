"use client"

import {
  SignIn,
  SignUp,
} from "@clerk/nextjs"
import Link from "next/link"
import { useState } from "react"

type ClerkAuthCardProps = {
  mode: "sign-in" | "sign-up"
}

const authAppearance = {
  elements: {
    rootBox: "w-full min-w-0",
    card: "w-full max-w-full",
  },
}

export function ClerkAuthCard({
  mode,
}: ClerkAuthCardProps) {
  if (mode === "sign-up") {
    return <SignUpWithConsent />
  }

  return (
    <div className="decisionate-auth-card w-full min-w-0 overflow-hidden">
      <SignIn
        fallbackRedirectUrl="/auth/redirect"
        forceRedirectUrl="/auth/redirect"
        withSignUp={false}
        signUpUrl="/sign-up"
        signUpFallbackRedirectUrl="/onboarding"
        appearance={authAppearance}
      />
    </div>
  )
}

function SignUpWithConsent() {
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [privacyAccepted, setPrivacyAccepted] = useState(false)
  const canContinue = termsAccepted && privacyAccepted

  if (!canContinue) {
    return (
      <section
        aria-labelledby="sign-up-consent-title"
        className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
      >
        <h2
          id="sign-up-consent-title"
          className="text-lg font-semibold text-gray-950"
        >
          Before you create your account
        </h2>
        <p className="mt-2 text-sm leading-6 text-gray-600">
          Please review and accept both documents to continue to sign up.
        </p>

        <div className="mt-5 space-y-4">
          <label className="flex items-start gap-3 text-sm leading-6 text-gray-700">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(event) => setTermsAccepted(event.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 accent-[var(--decisionate-brand-primary)]"
            />
            <span>
              I have read and agree to the{" "}
              <Link
                href="/terms"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-[var(--decisionate-brand-primary-text)] underline underline-offset-2"
              >
                Terms of Service
              </Link>
              .
            </span>
          </label>

          <label className="flex items-start gap-3 text-sm leading-6 text-gray-700">
            <input
              type="checkbox"
              checked={privacyAccepted}
              onChange={(event) => setPrivacyAccepted(event.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 accent-[var(--decisionate-brand-primary)]"
            />
            <span>
              I have read and acknowledge the{" "}
              <Link
                href="/privacy"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-[var(--decisionate-brand-primary-text)] underline underline-offset-2"
              >
                Privacy Policy
              </Link>
              .
            </span>
          </label>
        </div>

        <p className="mt-5 text-xs leading-5 text-gray-500">
          You can continue after both acknowledgements are selected.
        </p>
      </section>
    )
  }

  return (
    <div className="decisionate-auth-card w-full min-w-0 max-w-md overflow-hidden">
      <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
        Terms of Service and Privacy Policy acknowledged.
      </div>
      <SignUp
        fallbackRedirectUrl="/onboarding"
        forceRedirectUrl="/onboarding"
        signInFallbackRedirectUrl="/dashboard"
        appearance={authAppearance}
      />
    </div>
  )
}
