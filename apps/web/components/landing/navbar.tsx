"use client"

import Image from "next/image"
import Link from "next/link"
import { Menu, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useLandingText } from "@/app/use-decisionate-language"

const navLinks = [
  { label: "Product", href: "#product" },
  { label: "Integrations", href: "#integrations" },
  { label: "Pricing", href: "#pricing" },
  { label: "Questions", href: "#questions" }
] as const

export function LandingNavbar() {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const { t } = useLandingText()
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && menuOpen) {
        setMenuOpen(false)
        menuButtonRef.current?.focus()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [menuOpen])

  return (
    <header className="landing-nav sticky top-0 z-40 border-b border-neutral-200 bg-white">
      <a
        href="#main-content"
        className="workspace-skip-link rounded-md bg-white px-4 py-2 text-sm font-semibold text-neutral-950"
      >
        {t("Skip to content")}
      </a>
      <div className="landing-container landing-nav-inner flex min-h-18 items-center justify-between gap-3">
        <Link
          href="/"
          className="landing-brand-lockup min-w-0"
          aria-label={t("Decisionate home")}
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
            <span className="landing-brand-name text-neutral-950">
              Decisionate
            </span>
            <span className="landing-brand-tagline text-neutral-500">
              {t("Decisions from Data.")}
            </span>
          </span>
        </Link>
        <nav
          className="hidden items-center gap-7 xl:flex"
          aria-label={t("Main navigation")}
        >
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="inline-flex min-h-11 items-center text-sm text-neutral-600 hover:text-neutral-950"
            >
              {t(link.label)}
            </a>
          ))}
        </nav>
        <div className="landing-nav-actions flex items-center gap-2 sm:gap-4">
          <Link
            href="/sign-in"
            className="landing-desktop-auth landing-sign-in min-h-11 items-center text-sm font-medium text-neutral-700 hover:text-neutral-950"
          >
            {t("Sign in")}
          </Link>
          <Link
            href="/sign-up"
            className="landing-desktop-auth landing-button landing-button-primary text-sm"
          >
            {t("Start trial")}
          </Link>
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={t(menuOpen ? "Close navigation" : "Open navigation")}
            title={t(menuOpen ? "Close navigation" : "Open navigation")}
            aria-expanded={menuOpen}
            aria-controls="landing-mobile-navigation"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-neutral-700 xl:hidden"
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
      <nav
        id="landing-mobile-navigation"
        hidden={!menuOpen}
        aria-label={t("Mobile navigation")}
        className="landing-container landing-mobile-navigation gap-1 border-t border-neutral-200 py-3"
      >
        {navLinks.map((link) => (
          <a
            key={link.href}
            href={link.href}
            onClick={() => setMenuOpen(false)}
            className="flex min-h-11 items-center py-3 text-sm text-neutral-700"
          >
            {t(link.label)}
          </a>
        ))}
        <Link
          href="/demo"
          onClick={() => setMenuOpen(false)}
          className="landing-brand-link flex min-h-11 items-center py-3 text-sm font-medium"
        >
          {t("Explore live demo")}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-6 border-t border-neutral-200 pt-4">
          <Link
            href="/sign-in"
            onClick={() => setMenuOpen(false)}
            className="flex min-h-11 items-center text-sm font-medium text-neutral-700"
          >
            {t("Sign in")}
          </Link>
          <Link
            href="/sign-up"
            onClick={() => setMenuOpen(false)}
            className="landing-button landing-button-primary"
          >
            {t("Start trial")}
          </Link>
        </div>
      </nav>
    </header>
  )
}
