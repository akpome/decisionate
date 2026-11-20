"use client"

import Image from "next/image"
import Link from "next/link"
import type { ReactNode } from "react"

import { AuthPageCopy } from "@/app/auth-page-copy"
import { ThemeToggle } from "@/app/theme-toggle"
import { useDecisionateText } from "@/app/use-decisionate-language"
import { getHostedInvitationWorkspaceId, getSignInUrl, getSignUpUrl } from "../lib/auth-redirects"
import { portalBrand } from "@/lib/portal-brand"
import { useHostedPortal } from "@/features/hosted-subdomains/provider"
import { getHostedLogo } from "@/features/hosted-subdomains/types"

export function AuthLayout({ mode, title, description, returnTo, showAccountLink = true, children }: {
  mode: "sign-in" | "sign-up"
  title: string
  description: string
  returnTo?: string | null
  showAccountLink?: boolean
  children: ReactNode
}) {
  const { t } = useDecisionateText()
  const { returnTo: hostedReturn, authPortal } = useHostedPortal()
  const authBrand = authPortal?.branding
  const invitedWorkspaceId = getHostedInvitationWorkspaceId(hostedReturn)
  const showAccountAction = showAccountLink && (mode === "sign-up" || !authBrand || Boolean(invitedWorkspaceId))
  const name = authBrand?.name || portalBrand.name
  const logo = authBrand ? getHostedLogo(authBrand) : portalBrand.logo
  const pageDescription = authBrand
    ? invitedWorkspaceId ? "Use the email address that received your invitation."
      : mode === "sign-in" ? `Welcome back to ${name}.` : `Create your account for ${name}.`
    : portalBrand.id ? description.replaceAll("Decisionate", portalBrand.name) : description
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 sm:px-6">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4">
        <Link href={authBrand ? authPortal.origin : "/"} className="inline-flex min-w-0 items-center gap-2 text-lg font-semibold text-gray-950">
          {logo && <Image src={logo} alt="" width={32} height={32} className="h-8 w-8 shrink-0 object-contain" priority unoptimized />}
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{name}</span>
        </Link>
        <ThemeToggle />
      </header>
      <div className="mx-auto mt-10 w-full min-w-0 max-w-[26rem] sm:mt-14">
        <AuthPageCopy title={title} description={pageDescription} />
        <div className="mt-6 min-w-0">{children}</div>
        {showAccountAction && <p className="mt-6 text-center text-sm text-gray-600">
          {t(mode === "sign-in" ? (authBrand ? "Invited to this workspace?" : portalBrand.id ? "New here?" : "New to Decisionate?") : "Already have an account?")}{" "}
          <Link href={hostedReturn ? `${mode === "sign-in" ? "/sign-up" : "/sign-in"}?redirect_url=${encodeURIComponent(hostedReturn)}` : mode === "sign-in" ? getSignUpUrl(returnTo) : getSignInUrl(returnTo)} className="font-semibold text-[var(--decisionate-brand-primary-text)] underline underline-offset-4">
            {t(mode === "sign-in" ? (authBrand ? "Create your login" : "Create an account") : "Sign in")}
          </Link>
        </p>}
        <footer className="my-8 flex justify-center gap-5 text-xs text-gray-500">
          <Link href={portalBrand.terms} className="hover:underline">{t("Terms of Service")}</Link>
          <Link href={portalBrand.privacy} className="hover:underline">{t("Privacy Policy")}</Link>
        </footer>
      </div>
    </main>
  )
}
