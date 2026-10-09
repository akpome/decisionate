import Image from "next/image"
import Link from "next/link"
import type { ReactNode } from "react"

import { LandingFooter } from "@/components/landing/footer"
import "./landing.css"

type PolicyPageProps = {
  eyebrow: string
  title: string
  description: string
  updated: string
  children: ReactNode
}

export function PolicyPage({
  eyebrow,
  title,
  description,
  updated,
  children,
}: PolicyPageProps) {
  return (
    <div className="landing-page min-h-screen bg-white text-neutral-950">
      <header className="border-b border-neutral-200 bg-white">
        <div className="landing-container flex items-center justify-between gap-4 py-4">
          <Link href="/" className="landing-brand-lockup min-w-0" aria-label="Decisionate home">
            <span className="landing-brand-mark">
              <Image
                src="/icons/decisionate-logo.png"
                alt=""
                width={42}
                height={42}
              />
            </span>
            <span className="landing-brand-copy">
              <span className="landing-brand-name">Decisionate</span>
              <span className="landing-brand-tagline text-neutral-500">Decisions from Data.</span>
            </span>
          </Link>
          <Link
            href="/sign-in"
            className="landing-brand-link shrink-0 text-sm font-semibold"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main>
        <section className="border-b border-neutral-200 bg-neutral-50">
          <div className="mx-auto max-w-4xl px-5 py-12 sm:px-8">
            <p className="landing-eyebrow">
              {eyebrow}
            </p>
            <h1 className="mt-3 text-3xl font-semibold text-neutral-950 sm:text-4xl">
              {title}
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-neutral-600">
              {description}
            </p>
            <p className="mt-4 text-sm text-neutral-500">Last updated: {updated}</p>
          </div>
        </section>
        <section className="policy-content mx-auto max-w-4xl px-5 py-12 sm:px-8">
          <div className="space-y-9 text-[15px] leading-7 text-neutral-700">{children}</div>
        </section>
      </main>

      <LandingFooter />
    </div>
  )
}

export function PolicySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="break-words text-xl font-semibold text-neutral-950">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  )
}
