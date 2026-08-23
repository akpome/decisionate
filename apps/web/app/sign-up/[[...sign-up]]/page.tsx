import Link from "next/link"
import type { ReactNode } from "react"

import { AuthCard } from "@/app/auth-card"
import { ThemeToggle } from "@/app/theme-toggle"

export default function SignUpPage() {
  return (
    <AuthShell
      title="Create your Decisionate workspace"
      description="Start with your own business workspace, then add agency branding, teammates, or client access when you need it."
    >
      <AuthCard mode="sign-up" />
    </AuthShell>
  )
}

function AuthShell({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <main className="min-h-screen overflow-x-hidden bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl justify-end">
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

          <h1 className="mt-5 text-3xl font-bold tracking-tight text-gray-950 sm:text-5xl">
            {title}
          </h1>

          <p className="mt-4 text-lg leading-8 text-gray-600">
            {description}
          </p>
        </section>

        <section
          aria-label="Sign up"
          className="order-first flex min-w-0 justify-center lg:order-last"
        >
          {children}
        </section>
      </div>
    </main>
  )
}
