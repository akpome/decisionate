"use client"

import Image from "next/image"
import Link from "next/link"
import { ArrowRight, Play } from "lucide-react"
import { useLandingText } from "@/app/use-decisionate-language"

export function LandingHero() {
  const { t } = useLandingText()
  return (
    <section className="landing-hero relative isolate overflow-hidden border-b border-neutral-200 bg-white">
      <Image
        src="/media/decisionate-overview.webp"
        alt=""
        fill
        preload
        sizes="100vw"
        className="landing-hero-image -z-10 object-contain object-bottom"
      />
      <div className="landing-container relative pt-12 sm:pt-16">
        <p className="mb-3 text-sm font-medium text-teal-800">
          {t("For businesses and agencies")}
        </p>
        <h1 className="landing-hero-title font-semibold text-neutral-950">
          Decisionate
        </h1>
        <p className="mt-4 max-w-2xl text-xl leading-8 text-neutral-800 sm:text-2xl">
          <span className="sm:hidden">
            {t("Your data. Your next decision.")}
          </span>
          <span className="hidden sm:inline">
            {t("Your business data. A clearer next decision.")}
          </span>
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
          <a
            href="#product"
            className="landing-button landing-button-secondary"
          >
            <Play size={15} aria-hidden="true" />
            <span className="sm:hidden">{t("Demo")}</span>
            <span className="hidden sm:inline">{t("Watch the workflow")}</span>
          </a>
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          {t("No credit card required.")}
        </p>
      </div>
      <div className="landing-hero-caption landing-container absolute inset-x-0 bottom-5 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
        <span>{t("Marketing Performance · demonstration data")}</span>
        <Link
          href="/demo"
          className="inline-flex items-center gap-2 font-medium text-teal-800"
        >
          {t("Explore the live demo")}
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </section>
  )
}
