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
              <p className="landing-hero-promise font-semibold text-neutral-950">
                {t("Decide what to change this week. See whether it helped.")}
              </p>
              <p className="landing-hero-copy max-w-lg text-neutral-600">
                {t("Sales are up. Is profit up too? Bring your sales, marketing and accounting figures together to answer questions like this. Record what you'll try and when you'll check the result.")}
              </p>
              <dl className="grid max-w-lg gap-3 text-sm leading-5 text-neutral-600">
                <div><dt className="font-semibold text-neutral-950">{t("Find where your money goes further.")}</dt><dd>{t("Compare revenue per advertising dollar, or see which products leave the most money after costs.")}</dd></div>
                <div><dt className="font-semibold text-neutral-950">{t("Catch a tight week before it arrives.")}</dt><dd>{t("Line up expected payments and bills. Try a late payment to see when your cash balance could fall short.")}</dd></div>
                <div><dt className="font-semibold text-neutral-950">{t("See how many buyers come back.")}</dt><dd>{t("Check how many customers make a second purchase within 30, 60 or 90 days. Use what you learn to choose when to send a reminder.")}</dd></div>
                <div><dt className="font-semibold text-neutral-950">{t("Follow through on the change you make.")}</dt><dd>{t("Set a target for what you will change and the result you want. On review day, compare both with what actually happened.")}</dd></div>
              </dl>
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
