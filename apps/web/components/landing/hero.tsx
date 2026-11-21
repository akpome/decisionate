"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { useLandingText } from "@/app/use-decisionate-language"
import { prefetchPublicDemo } from "@/features/demo/lib/demo-data"
import { LandingProductDemo } from "./landing-product-demo"
import { DECISIONATE_AUTH_LINKS } from "@/lib/decisionate-domains"

export function LandingHero() {
  const { t } = useLandingText()
  return (
    <section id="product" className="landing-hero border-b border-neutral-200 bg-white">
      <div className="landing-container">
        <LandingProductDemo>
          <div className="landing-hero-intro min-w-0">
            <div className="landing-hero-message">
              <h1 className="landing-hero-title font-semibold text-neutral-950">
                {t("Decisionate")}
              </h1>
              <p className="landing-hero-promise max-w-lg font-semibold text-neutral-950">
                {t("Decide what to change this week. See whether it helped.")}
              </p>
              <p className="landing-hero-copy max-w-lg text-neutral-600">
                {t("Sales are up. Is profit up too? Bring your sales, marketing and accounting figures together to answer questions like this. Record what you'll try and when you'll check the result.")}
              </p>
            </div>
            <div className="landing-hero-cta">
              <div className="landing-hero-actions">
                <Link
                  href={DECISIONATE_AUTH_LINKS.signUp}
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
