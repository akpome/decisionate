import Link from "next/link"

import { AuthCard } from "@/app/auth-card"
import { ThemeToggle } from "@/app/theme-toggle"

export default function SignInPage() {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl justify-end">
        <ThemeToggle />
      </div>

      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl items-center gap-8 lg:grid-cols-[minmax(0,1fr)_auto]">
        <section className="max-w-2xl">
          <Link
            href="/"
            className="text-sm font-semibold text-[var(--decisionate-brand-primary-text)]"
          >
            Decisionate
          </Link>

          <h1 className="mt-5 text-3xl font-bold tracking-tight text-gray-950 sm:text-5xl">
            Welcome back
          </h1>

          <p className="mt-4 text-lg leading-8 text-gray-600">
            Sign in to continue with your dashboards, datasets, alerts, and decision follow-up.
          </p>
        </section>

        <section
          aria-label="Sign in"
          className="flex justify-center"
        >
          <div className="w-full max-w-[24rem]">
            <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-center text-sm text-blue-900">
              New user?{" "}
              <Link
                href="/sign-up"
                className="font-semibold underline underline-offset-2"
              >
                Create your account
              </Link>
            </div>

            <AuthCard mode="sign-in" />
          </div>
        </section>
      </div>
    </main>
  )
}
