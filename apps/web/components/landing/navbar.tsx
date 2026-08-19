"use client"

import Link from "next/link"
import Image from "next/image"
import {
  Menu,
  X,
} from "lucide-react"
import {
  useState,
} from "react"

import { ThemeToggle } from "@/app/theme-toggle"

const navLinks = [
  { label: "Product", href: "#product" },
  { label: "Solutions", href: "#solutions" },
  { label: "Industry Dashboards", href: "#industries" },
  { label: "Pricing", href: "#pricing" },
  { label: "Resources", href: "#resources" },
  { label: "Company", href: "#company" },
] as const

export function LandingNavbar() {
  const [menuOpen, setMenuOpen] = useState(false)

  function closeMenu() {
    setMenuOpen(false)
  }

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2.5"
          aria-label="Decisionate home"
        >
          <Image
            src="/icons/decisionate-icon.svg"
            alt=""
            width={32}
            height={32}
            className="h-8 w-8"
          />
          <span className="flex flex-col leading-none">
            <span className="text-[17px] font-bold tracking-tight text-slate-950">
              Decisionate
            </span>
            <span className="mt-1 whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              Decisions, automated.
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-6 lg:flex" aria-label="Main navigation">
          {navLinks.map(link => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-slate-600 transition hover:text-slate-950"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <ThemeToggle />
          <Link
            href="/sign-in"
            className="px-2 py-2 text-sm font-semibold text-slate-700 transition hover:text-slate-950"
          >
            Sign In
          </Link>
          <Link
            href="/sign-up"
            className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            Start Free Trial
          </Link>
        </div>

        <div className="flex items-center gap-2 lg:hidden">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setMenuOpen(value => !value)}
            title={menuOpen ? "Close navigation" : "Open navigation"}
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={menuOpen}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-700"
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="border-t border-slate-200 bg-white px-5 py-4 lg:hidden">
          <nav className="flex flex-col gap-1" aria-label="Mobile navigation">
            {navLinks.map(link => (
              <a
                key={link.href}
                href={link.href}
                onClick={closeMenu}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {link.label}
              </a>
            ))}
            <div className="mt-3 flex gap-3 border-t border-slate-100 pt-4">
              <Link
                href="/sign-in"
                onClick={closeMenu}
                className="flex-1 rounded-lg border border-slate-200 px-4 py-2.5 text-center text-sm font-semibold text-slate-700"
              >
                Sign In
              </Link>
              <Link
                href="/sign-up"
                onClick={closeMenu}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-center text-sm font-semibold text-white"
              >
                Start Free Trial
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}
