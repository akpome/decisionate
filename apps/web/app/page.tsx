import Link from "next/link"

import { ThemeToggle } from "@/app/theme-toggle"

const audienceCards = [
  {
    title: "Direct businesses",
    description:
      "Upload datasets, track KPIs, forecast outcomes, and turn insight into decisions.",
  },
  {
    title: "Agencies",
    description:
      "Manage client workspaces with branded dashboards, reports, alerts, and decision follow-up.",
  },
  {
    title: "Client viewers",
    description:
      "Give clients a focused portal for the workspaces and decisions shared with them.",
  },
]

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl justify-end">
        <ThemeToggle />
      </div>

      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-6xl flex-col justify-center gap-10">
        <section className="mx-auto max-w-4xl text-center">
          <p className="mb-4 text-sm font-semibold uppercase tracking-wide text-[var(--decisionate-brand-primary-text)]">
            Decision intelligence for growing businesses
          </p>

          <h1 className="text-4xl font-bold tracking-tight text-gray-950 sm:text-6xl">
            Decisionate
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-gray-600 sm:text-xl">
            Turn operational data into clearer decisions, with the forecasts, alerts, and accountable follow-up to learn what works.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/sign-up"
              className="inline-flex w-full items-center justify-center rounded-xl bg-[var(--decisionate-brand-primary)] px-6 py-3 text-sm font-medium text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90 sm:w-auto"
            >
              Get Started
            </Link>

            <Link
              href="/sign-in"
              className="inline-flex w-full items-center justify-center rounded-xl border border-gray-200 px-6 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 sm:w-auto"
            >
              Sign In
            </Link>
          </div>
        </section>

        <section
          aria-label="Decisionate use cases"
          className="grid gap-4 md:grid-cols-3"
        >
          {audienceCards.map((card) => (
            <article
              key={card.title}
              className="rounded-2xl border bg-gray-50 p-5"
            >
              <h2 className="text-lg font-semibold text-gray-950">
                {card.title}
              </h2>

              <p className="mt-2 text-sm leading-6 text-gray-600">
                {card.description}
              </p>
            </article>
          ))}
        </section>
      </div>
    </main>
  )
}
