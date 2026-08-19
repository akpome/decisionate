import Image from "next/image"
import Link from "next/link"
import type { ReactNode } from "react"

import { LandingFooter } from "@/components/landing/footer"

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
    <div className="min-h-screen bg-white text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/icons/decisionate-icon.svg"
              alt="Decisionate"
              width={34}
              height={34}
              className="h-8 w-8"
            />
            <span className="text-lg font-bold tracking-tight">Decisionate</span>
          </Link>
          <Link
            href="/sign-in"
            className="text-sm font-semibold text-blue-700 hover:text-blue-800"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main>
        <section className="border-b border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-5xl px-5 py-16 sm:px-8 lg:py-20">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700">
              {eyebrow}
            </p>
            <h1 className="mt-4 max-w-3xl text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">
              {title}
            </h1>
            <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-600">
              {description}
            </p>
            <p className="mt-5 text-sm text-slate-500">Last updated: {updated}</p>
          </div>
        </section>
        <section className="mx-auto max-w-5xl px-5 py-12 sm:px-8 lg:py-16">
          <div className="space-y-10 text-[15px] leading-7 text-slate-700">{children}</div>
        </section>
      </main>

      <LandingFooter />
    </div>
  )
}

export function PolicySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-2xl font-bold tracking-tight text-slate-950">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  )
}
