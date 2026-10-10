"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { useLandingText } from "@/app/use-decisionate-language"
import { prefetchPublicDemo } from "@/features/demo/lib/demo-data"
import { LandingProductDemo } from "./landing-product-demo"

export function LandingHero() {
  const { t } = useLandingText()
  const productSummary = t(
    "Connect accounting, sales and marketing tools, or upload spreadsheets. Spot trends with AI-assisted insights. Build reports, record decisions, assign actions and track outcomes in one workspace."
  )
  const compactSummary = t(
    "Connect business tools or spreadsheets. Explore insights, decide what to do next and track the results."
  )
  const automationSummary = t(
    "Automatic daily syncing keeps connected data current. Weekly performance reports and KPI alerts arrive by email."
  )
  const teamSummary = t(
    "Work together in one business workspace, or manage separate client workspaces with your agency's branding and role-based access."
  )
  return (
    <section id="product" className="landing-hero border-b border-neutral-200 bg-white">
      <div className="landing-container">
        <LandingProductDemo>
          <div className="landing-hero-intro min-w-0">
            <div className="landing-hero-message">
              <div className="landing-hero-heading flex flex-col gap-2">
                <h1 className="landing-hero-title font-semibold text-neutral-950">
                  Decisionate
                </h1>
                <p className="landing-hero-subtitle text-xl leading-7 text-neutral-800 sm:text-2xl sm:leading-8">
                  {t("Insights from existing business data.")}
                </p>
              </div>
              <p className="landing-hero-copy max-w-lg text-neutral-600">
                {productSummary}
              </p>
              <p className="landing-hero-copy-compact max-w-lg text-neutral-600">
                {compactSummary}
              </p>
              <p className="landing-hero-automation max-w-lg text-neutral-600">
                {automationSummary}
              </p>
              <p className="landing-hero-team max-w-lg text-neutral-600">
                {teamSummary}
              </p>
            </div>
            <div className="landing-hero-cta">
              <div className="landing-hero-actions flex flex-wrap items-end gap-3">
                <Link
                  href="/sign-up"
                  className="landing-button landing-button-primary"
                >
                  <span className="landing-trial-short sm:hidden">{t("Start trial")}</span>
                  <span className="landing-trial-full hidden sm:inline">
                    {t("Start your 30-day trial")}
                  </span>
                  <ArrowRight
                    size={16}
                    aria-hidden="true"
                    className="hidden sm:block"
                  />
                </Link>
                <Link
                  href="/demo"
                  prefetch
                  onPointerEnter={prefetchPublicDemo}
                  onFocus={prefetchPublicDemo}
                  onTouchStart={prefetchPublicDemo}
                  className="landing-button landing-button-accent"
                >
                  {t("Explore live demo")}
                  <ArrowRight size={16} aria-hidden="true" className="hidden sm:block" />
                </Link>
              </div>
              <p className="landing-hero-note text-neutral-500">
                {t("No credit card required.")}
              </p>
            </div>
          </div>
        </LandingProductDemo>
        <div className="landing-hero-more">
          <p className="landing-hero-copy-mobile max-w-lg text-neutral-600">
            {productSummary}
          </p>
          <p className="landing-hero-automation-mobile max-w-lg text-neutral-600">
            {automationSummary}
          </p>
          <p className="landing-hero-team-mobile max-w-lg text-neutral-600">
            {teamSummary}
          </p>
        </div>
      </div>
    </section>
  )
}
