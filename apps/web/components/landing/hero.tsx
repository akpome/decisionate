"use client"

import Link from "next/link"
import { ArrowRight, Play } from "lucide-react"
import { useLandingText } from "@/app/use-decisionate-language"
import { prefetchPublicDemo } from "@/features/demo/lib/demo-data"

export function LandingHero() {
  const { t } = useLandingText()
  return (
    <section className="landing-hero border-b border-neutral-200 bg-white">
      <div className="landing-container">
        <p className="landing-brand-text mb-3 text-sm font-medium">
          {t("For businesses and agencies")}
        </p>
        <h1 className="landing-hero-title font-semibold text-neutral-950">
          Decisionate
        </h1>
        <p className="mt-4 max-w-2xl text-xl leading-8 text-neutral-800 sm:text-2xl">
          {t("Decisions from Data.")}
        </p>
        <p className="landing-hero-copy mt-4 hidden max-w-xl text-base leading-7 text-neutral-600 sm:block">
          {t(
            "Bring your numbers together, see what changed, and keep the action and its outcome in one workspace."
          )}
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3 sm:mt-7">
          <Link
            href="/sign-up"
            className="landing-button landing-button-primary"
          >
            <span className="sm:hidden">{t("Start trial")}</span>
            <span className="hidden sm:inline">
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
            className="landing-button landing-button-secondary"
          >
            {t("Explore live demo")}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          {t("No credit card required.")}
        </p>
        <a
          href="#product"
          className="landing-brand-link mt-5 inline-flex items-center gap-2 text-sm font-medium"
        >
          <Play size={15} aria-hidden="true" />
          {t("Watch the workflow")}
        </a>
      </div>
    </section>
  )
}
