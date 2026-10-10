"use client"

import {
  ClerkFailed,
  ClerkLoaded,
  ClerkLoading,
  SignIn,
  SignUp,
} from "@clerk/nextjs"
import Link from "next/link"
import { useState, useSyncExternalStore } from "react"
import { ArrowRight, RefreshCw } from "lucide-react"

import { useDecisionateText } from "@/app/use-decisionate-language"
import { getAuthRedirectUrl, getSignInUrl, getSignUpUrl } from "@/features/auth/lib/auth-redirects"
import { readSignupConsent, subscribeSignupConsent, writeSignupConsent } from "@/features/auth/lib/signup-consent"

type ClerkAuthCardProps = {
  mode: "sign-in" | "sign-up"
  returnTo?: string | null
}

const authAppearance = {
  elements: {
    rootBox: "w-full min-w-0",
    cardBox: "w-full max-w-full rounded-lg shadow-sm",
    card: "w-full max-w-full rounded-lg shadow-none",
    footerAction: { display: "none" as const },
  },
}

export function ClerkAuthCard({
  mode,
  returnTo,
}: ClerkAuthCardProps) {
  const { t } = useDecisionateText()
  const redirectUrl = getAuthRedirectUrl(returnTo)

  if (mode === "sign-up") {
    return <SignUpWithConsent returnTo={returnTo} />
  }

  return (
    <div className="decisionate-auth-card w-full min-w-0 overflow-hidden">
      <ClerkLoading>
        <div
          role="status"
          aria-live="polite"
          className="min-h-24 rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600"
        >
          {t("Loading sign in...")}
        </div>
      </ClerkLoading>
      <ClerkLoaded>
        <SignIn
          routing="path"
          path="/sign-in"
          fallbackRedirectUrl={redirectUrl}
          forceRedirectUrl={redirectUrl}
          withSignUp={false}
          transferable={false}
          signUpUrl={getSignUpUrl(returnTo)}
          signUpFallbackRedirectUrl={redirectUrl}
          signUpForceRedirectUrl={redirectUrl}
          appearance={authAppearance}
        />
      </ClerkLoaded>
      <ClerkFailed>
        <ClerkFailureState />
      </ClerkFailed>
    </div>
  )
}

function SignUpWithConsent({ returnTo }: { returnTo?: string | null }) {
  const { t } = useDecisionateText()
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [privacyAccepted, setPrivacyAccepted] = useState(false)
  const [continued, setContinued] = useState(false)
  const storedConsent = useSyncExternalStore(subscribeSignupConsent, readSignupConsent, () => false)
  const canContinue = termsAccepted && privacyAccepted
  const redirectUrl = getAuthRedirectUrl(returnTo)

  if (!continued && !storedConsent) {
    return (
      <section
        aria-labelledby="sign-up-consent-title"
        className="w-full rounded-lg border border-gray-200 bg-white p-5 sm:p-6"
      >
        <h2
          id="sign-up-consent-title"
          className="text-lg font-semibold text-gray-950"
        >
          {t("Before you create your account")}
        </h2>
        <p className="mt-2 text-sm leading-6 text-gray-600">
          {t("Please review and accept both documents to continue to sign up.")}
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
              {t("I have read and agree to the")} {" "}
              <Link
                href="/terms"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-[var(--decisionate-brand-primary-text)] underline underline-offset-2"
              >
                {t("Terms of Service")}
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
              {t("I have read and acknowledge the")} {" "}
              <Link
                href="/privacy"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-[var(--decisionate-brand-primary-text)] underline underline-offset-2"
              >
                {t("Privacy Policy")}
              </Link>
              .
            </span>
          </label>
        </div>

        <button
          type="button"
          disabled={!canContinue}
          onClick={() => {
            writeSignupConsent(true)
            setContinued(true)
          }}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--decisionate-brand-primary)] px-4 py-3 text-sm font-semibold text-[var(--decisionate-brand-primary-surface-text)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("Continue")}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </section>
    )
  }

  return (
    <div className="decisionate-auth-card w-full min-w-0 max-w-md overflow-hidden">
      <p className="mb-3 text-xs text-gray-500">
        {t("Terms of Service and Privacy Policy acknowledged.")}
      </p>
      <ClerkLoading>
        <div
          role="status"
          aria-live="polite"
          className="min-h-24 rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600"
        >
          {t("Loading sign up...")}
        </div>
      </ClerkLoading>
      <ClerkLoaded>
        <SignUp
          routing="path"
          path="/sign-up"
          fallbackRedirectUrl={redirectUrl}
          forceRedirectUrl={redirectUrl}
          signInUrl={getSignInUrl(returnTo)}
          signInFallbackRedirectUrl={redirectUrl}
          signInForceRedirectUrl={redirectUrl}
          appearance={authAppearance}
        />
      </ClerkLoaded>
      <ClerkFailed>
        <ClerkFailureState />
      </ClerkFailed>
    </div>
  )
}

function ClerkFailureState() {
  const { t } = useDecisionateText()

  return (
    <div
      role="alert"
      className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-sm text-rose-900"
    >
      <p className="font-semibold">
        {t("Sign-in service could not be loaded.")}
      </p>
      <p className="mt-2 leading-6">
        {t("Check the connection and try again.")}
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-rose-700 px-4 py-2 font-semibold text-white hover:bg-rose-800"
      >
        <RefreshCw size={16} aria-hidden="true" />
        {t("Try again")}
      </button>
    </div>
  )
}
