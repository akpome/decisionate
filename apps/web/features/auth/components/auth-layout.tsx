"use client"

import Image from "next/image"
import Link from "next/link"
import type { ReactNode } from "react"

import { AuthPageCopy } from "@/app/auth-page-copy"
import { ThemeToggle } from "@/app/theme-toggle"
import { useDecisionateText } from "@/app/use-decisionate-language"
import { getSignInUrl, getSignUpUrl } from "../lib/auth-redirects"

export function AuthLayout({ mode, title, description, returnTo, children }: {
  mode: "sign-in" | "sign-up"
  title: string
  description: string
  returnTo?: string | null
  children: ReactNode
}) {
  const { t } = useDecisionateText()
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 sm:px-6">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4">
        <Link href="/" className="inline-flex min-w-0 items-center gap-2 text-lg font-semibold text-gray-950">
          <Image src="/icons/decisionate-logo.png" alt="" width={32} height={32} priority />
          Decisionate
        </Link>
        <ThemeToggle />
      </header>
      <div className="mx-auto mt-10 w-full min-w-0 max-w-[26rem] sm:mt-14">
        <AuthPageCopy title={title} description={description} />
        <div className="mt-6 min-w-0">{children}</div>
        <p className="mt-6 text-center text-sm text-gray-600">
          {t(mode === "sign-in" ? "New to Decisionate?" : "Already have an account?")}{" "}
          <Link href={mode === "sign-in" ? getSignUpUrl(returnTo) : getSignInUrl(returnTo)} className="font-semibold text-[var(--decisionate-brand-primary-text)] underline underline-offset-4">
            {t(mode === "sign-in" ? "Create an account" : "Sign in")}
          </Link>
        </p>
        <footer className="my-8 flex justify-center gap-5 text-xs text-gray-500">
          <Link href="/terms" className="hover:underline">{t("Terms of Service")}</Link>
          <Link href="/privacy" className="hover:underline">{t("Privacy Policy")}</Link>
        </footer>
      </div>
    </main>
  )
}
