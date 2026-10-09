"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { useLandingText } from "@/app/use-decisionate-language"
import { prefetchPublicDemo } from "@/features/demo/lib/demo-data"
import { LandingProductDemo } from "./landing-product-demo"

export function LandingHero() {
  const { t } = useLandingText()
  return (
    <section id="product" className="landing-hero border-b border-neutral-200 bg-white">
      <div className="landing-container">
        <LandingProductDemo>
          <div className="landing-hero-intro min-w-0">
            <div className="space-y-2">
              <h1 className="landing-hero-title font-semibold text-neutral-950">
                Decisionate
              </h1>
              <p className="landing-hero-tagline text-xl leading-7 text-neutral-800 sm:text-2xl sm:leading-8">
                {t("Decisions from Data.")}
              </p>
            </div>
            <p className="landing-hero-copy mt-4 max-w-lg text-base leading-7 text-neutral-600">
              {t(
                "Bring your numbers together, see what changed, and keep the action and its outcome in one workspace."
              )}
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
            <p className="mt-2 text-xs leading-4 text-neutral-500">
              {t("No credit card required.")}
            </p>
          </div>
        </LandingProductDemo>
      </div>
    </section>
  )
}
