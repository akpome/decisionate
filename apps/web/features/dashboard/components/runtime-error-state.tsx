"use client"

import { AlertTriangle, RefreshCw } from "lucide-react"
import Link from "next/link"

type RuntimeErrorStateProps = {
  title: string
  description: string
  homeHref: string
  homeLabel: string
  errorDigest?: string
  reset: () => void
  mainClassName?: string
}

export function RuntimeErrorState({
  title,
  description,
  homeHref,
  homeLabel,
  errorDigest,
  reset,
  mainClassName = "flex min-h-[60vh] items-center justify-center px-4 py-12",
}: RuntimeErrorStateProps) {
  return (
    <main className={mainClassName}>
      <section
        role="alert"
        className="w-full max-w-lg rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm sm:p-8"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
          <AlertTriangle size={24} />
        </div>

        <h1 className="mt-4 text-xl font-semibold text-gray-950">{title}</h1>

        <p className="mt-2 text-sm leading-6 text-gray-500">{description}</p>

        {errorDigest && (
          <p className="mt-3 text-xs text-gray-400">Reference: {errorDigest}</p>
        )}

        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[var(--decisionate-brand-primary)] px-4 text-sm font-medium text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90"
          >
            <RefreshCw size={16} />
            Try again
          </button>

          <Link
            href={homeHref}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            {homeLabel}
          </Link>
        </div>
      </section>
    </main>
  )
}
