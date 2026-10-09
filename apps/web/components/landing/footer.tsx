"use client"

import Link from "next/link"
import Image from "next/image"
import { useLandingText } from "@/app/use-decisionate-language"

export function LandingFooter() {
  const { t } = useLandingText()
  return (
    <footer className="bg-neutral-950 py-10 text-neutral-400">
      <div className="landing-container">
        <div className="flex flex-col justify-between gap-8 sm:flex-row">
          <div>
            <Link
              href="/"
              className="landing-brand-lockup text-white"
            >
              <span className="landing-brand-mark">
                <Image
                  src="/icons/decisionate-logo.png"
                  alt=""
                  width={42}
                  height={42}
                />
              </span>
              <span className="landing-brand-copy">
                <span className="landing-brand-name">Decisionate</span>
                <span className="landing-brand-tagline text-neutral-400">{t("Decisions from Data.")}</span>
              </span>
            </Link>
          </div>
          <nav
            aria-label={t("Footer navigation")}
            className="flex flex-wrap items-start gap-x-6 gap-y-3 text-sm"
          >
            <Link href="/demo" className="hover:text-white">
              {t("Live demo")}
            </Link>
            <Link href="/security" className="hover:text-white">
              {t("Security")}
            </Link>
            <Link href="/privacy" className="hover:text-white">
              {t("Privacy")}
            </Link>
            <Link href="/terms" className="hover:text-white">
              {t("Terms")}
            </Link>
            <a
              href="mailto:support@decisionate.ca"
              className="hover:text-white"
            >
              {t("Support")}
            </a>
          </nav>
        </div>
        <div className="mt-8 flex flex-wrap justify-between gap-3 border-t border-neutral-800 pt-5 text-xs">
          <span>© 2026 Decisionate. {t("All rights reserved.")}</span>
          <Link href="/sign-in" className="hover:text-white">
            {t("Sign in")}
          </Link>
        </div>
      </div>
    </footer>
  )
}
