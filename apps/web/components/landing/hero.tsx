"use client"

import Link from "next/link"
import {
  ArrowRight,
  Play,
  X,
} from "lucide-react"
import {
  useState,
} from "react"

import { LandingDashboardPreview } from "@/components/landing/landing-dashboard-preview"
import { LandingProductDemo } from "@/components/landing/landing-product-demo"

export function LandingHero() {
  const [demoOpen, setDemoOpen] = useState(false)

  return (
    <section className="overflow-hidden bg-slate-950 text-white">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[0.86fr_1.14fr] lg:items-center lg:gap-10 lg:py-24">
        <div className="max-w-xl">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
            Decision automation for growing businesses
          </p>
          <h1 className="mt-5 text-4xl font-bold leading-[1.04] tracking-tight sm:text-6xl">
            Turn your business data into better decisions.
          </h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-slate-300 sm:text-lg">
            Decisionate is a decision automation platform powered by your business data. Connect your data, generate AI-powered insights and recommendations, make better decisions and measure outcomes.
          </p>
          <p className="mt-3 max-w-lg text-sm leading-6 text-slate-400">
            Business intelligence dashboards give your team a clear view of performance before the next decision.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => setDemoOpen(true)}
              title="Open the Decisionate product walkthrough"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 px-5 py-3 text-sm font-bold text-white transition hover:border-slate-500 hover:bg-slate-900"
            >
              <Play size={15} fill="currentColor" aria-hidden="true" />
              Watch Demo
            </button>
            <Link
              href="/demo"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-300/60 px-5 py-3 text-sm font-bold text-cyan-200 transition hover:border-cyan-200 hover:bg-slate-900"
            >
              Open Live Demo
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-400">
            <span>Start with your existing data</span>
            <span className="h-1 w-1 rounded-full bg-slate-600" aria-hidden="true" />
            <span>Built for growing teams</span>
          </div>
        </div>

        <LandingDashboardPreview />
      </div>

      {demoOpen && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 p-3 sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="demo-title"
          onClick={() => setDemoOpen(false)}
        >
          <div
            className="mx-auto flex min-h-full w-full max-w-5xl items-start justify-center py-1 sm:items-center sm:py-0"
            onClick={event => event.stopPropagation()}
          >
            <div className="w-full">
              <div className="sticky top-0 z-20 mb-3 flex items-center justify-between bg-slate-950/95 px-1 py-2 text-white backdrop-blur sm:bg-transparent sm:py-0">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-300">
                  Product demo
                </p>
                <h2 id="demo-title" className="mt-1 text-lg font-bold tracking-tight sm:text-xl">
                  From signal to learning
                </h2>
              </div>
                <button
                  type="button"
                  onClick={() => setDemoOpen(false)}
                  title="Close product demo"
                  aria-label="Close product demo"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800"
                >
                  <X size={17} aria-hidden="true" />
                </button>
              </div>
              <LandingProductDemo />
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
