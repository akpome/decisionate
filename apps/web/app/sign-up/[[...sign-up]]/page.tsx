import {
  auth,
} from "@clerk/nextjs/server"
import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactNode } from "react"

import { AuthCard } from "@/app/auth-card"
import { ThemeToggle } from "@/app/theme-toggle"

export default async function SignUpPage() {
  const {
    userId,
  } = await auth()

  if (userId) {
    redirect("/onboarding")
  }

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
            {title}
          </h1>

          <p className="mt-4 text-lg leading-8 text-gray-600">
            {description}
          </p>
        </section>

        <section
          aria-label="Sign up"
          className="flex justify-center"
        >
          {children}
        </section>
      </div>
    </main>
  )
}
