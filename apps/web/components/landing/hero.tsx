"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { useLandingText } from "@/app/use-decisionate-language"
import { prefetchPublicDemo } from "@/features/demo/lib/demo-data"
import { LandingProductDemo } from "./landing-product-demo"

export function LandingHero() {
  const { t } = useLandingText()
  const productSummary = t(
    "Connect your accounting, sales and marketing tools—or upload spreadsheets. Spot what needs attention with AI-assisted insights, assign actions and track results in one workspace."
  )
  const automationSummary = t(
    "Daily syncing keeps your connected data current. Enable weekly performance reports and KPI alerts by email."
  )
  return (
    <section id="product" className="landing-hero border-b border-neutral-200 bg-white">
      <div className="landing-container">
        <LandingProductDemo>
          <div className="landing-hero-intro min-w-0">
            <div className="landing-hero-message">
              <h1 className="landing-hero-title font-semibold text-neutral-950">
                {t("Turn your business data into better decisions.")}
              </h1>
              <p className="landing-hero-copy max-w-lg text-neutral-600">
                {productSummary}
              </p>
              <p className="landing-hero-automation max-w-lg text-neutral-600">
                {automationSummary}
              </p>
            </div>
            <div className="landing-hero-cta">
              <div className="landing-hero-actions">
                <Link
                  href="/sign-up"
                  className="landing-button landing-button-primary"
                >
                  {t("Start your 30-day trial")}
                  <ArrowRight size={16} aria-hidden="true" />
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
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </div>
              <p className="landing-hero-note text-neutral-500">
                {t("No credit card required.")}
              </p>
            </div>
          </div>
        </LandingProductDemo>
      </div>
    </section>
  )
}
