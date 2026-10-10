"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { useLandingText } from "@/app/use-decisionate-language"
import { prefetchPublicDemo } from "@/features/demo/lib/demo-data"
import { LandingProductDemo } from "./landing-product-demo"

export function LandingHero() {
  const { t } = useLandingText()
  const automationSummary = t(
    "Automatic daily syncing keeps connected data current. Weekly performance reports and KPI alerts arrive by email."
  )
  return (
    <section id="product" className="landing-hero border-b border-neutral-200 bg-white">
      <div className="landing-container">
        <LandingProductDemo>
          <div className="landing-hero-intro min-w-0">
            <div className="landing-hero-heading flex flex-col gap-2">
              <h1 className="landing-hero-title font-semibold text-neutral-950">
                Decisionate
              </h1>
              <p className="landing-hero-subtitle text-xl leading-7 text-neutral-800 sm:text-2xl sm:leading-8">
                {t("Insights from existing business data.")}
              </p>
            </div>
            <p className="landing-hero-copy mt-4 max-w-lg text-base leading-7 text-neutral-600">
              {t(
                "Connect accounting, sales and marketing tools, or upload spreadsheets. Spot trends and explore AI-assisted insights. Build reports, record decisions, assign actions and track outcomes in one workspace. Spend less time gathering data and more time acting on it."
              )}
            </p>
            <p className="landing-hero-automation hidden max-w-lg text-sm leading-[22px] text-neutral-600 lg:block">
              {automationSummary}
            </p>
            <div className="landing-hero-actions mt-6 flex flex-wrap items-center gap-3">
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
            <p className="landing-hero-note mt-2 text-xs leading-4 text-neutral-500">
              {t("No credit card required.")}
            </p>
          </div>
        </LandingProductDemo>
        <p className="landing-hero-automation-mobile mt-5 max-w-lg text-sm leading-6 text-neutral-600 lg:hidden">
          {automationSummary}
        </p>
      </div>
    </section>
  )
}
