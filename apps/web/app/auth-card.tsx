"use client"

import dynamic from "next/dynamic"

type AuthCardProps = {
  mode: "sign-in" | "sign-up"
}

const ClientOnlyClerkAuthCard =
  dynamic(
    () =>
      import("./clerk-auth-card").then(
        (module) => module.ClerkAuthCard
      ),
    {
      ssr: false,
      loading: () => <AuthCardSkeleton />,
    }
  )

export function AuthCard({
  mode,
}: AuthCardProps) {
  return (
    <ClientOnlyClerkAuthCard
      mode={mode}
    />
  )
}

function AuthCardSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading authentication form"
      className="w-full max-w-[24rem] rounded-2xl border bg-white p-6 shadow-sm"
    >
      <div className="h-6 w-32 rounded bg-gray-100" />
      <div className="mt-3 h-4 w-52 rounded bg-gray-100" />
      <div className="mt-8 space-y-3">
        <div className="h-11 rounded-xl bg-gray-100" />
        <div className="h-11 rounded-xl bg-gray-100" />
      </div>
      <div className="mt-6 h-11 rounded-xl bg-[var(--decisionate-brand-primary-soft)]" />
    </div>
  )
}
