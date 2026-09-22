import Link from "next/link"

import { AuthCard } from "@/app/auth-card"
import { ThemeToggle } from "@/app/theme-toggle"
import {
  AuthPageCopy,
  AuthSignupPrompt,
} from "@/app/auth-page-copy"

type SignInPageProps = {
  searchParams: Promise<{
    redirect_url?: string | string[]
  }>
}

function getAuthRedirectUrl(
  redirectValue: string | string[] | undefined
) {
  const candidate = Array.isArray(redirectValue)
    ? redirectValue[0]
    : redirectValue

  if (
    !candidate ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate === "/auth/redirect" ||
    candidate.startsWith("/auth/redirect?")
  ) {
    return "/auth/redirect"
  }

  return `/auth/redirect?redirect_url=${encodeURIComponent(candidate)}`
}

export default async function SignInPage({
  searchParams,
}: SignInPageProps) {
  const params = await searchParams
  const authRedirectUrl = getAuthRedirectUrl(
    params.redirect_url
  )

  return (
    <main className="min-h-screen overflow-x-hidden bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl justify-end gap-2">
        <ThemeToggle />
      </div>

      <div className="mx-auto grid min-h-[calc(100vh-4rem)] min-w-0 max-w-6xl items-start gap-8 lg:items-center lg:grid-cols-[minmax(0,1fr)_auto]">
        <section className="order-last min-w-0 max-w-2xl lg:order-first">
          <Link
            href="/"
            className="text-sm font-semibold text-[var(--decisionate-brand-primary-text)]"
          >
            Decisionate
          </Link>

          <AuthPageCopy
            title="Welcome back"
            description="Sign in to continue with your dashboards, datasets, alerts, and decision follow-up."
          />
        </section>

        <section
          aria-label="Sign in"
          className="order-first flex min-w-0 justify-center lg:order-last"
        >
          <div className="w-full min-w-0 max-w-[24rem]">
            <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-center text-sm text-blue-900">
              <AuthSignupPrompt />
            </div>

            <AuthCard
              mode="sign-in"
              redirectUrl={authRedirectUrl}
            />
          </div>
        </section>
      </div>
    </main>
  )
}
