"use client"

import {
  Languages,
} from "lucide-react"
import {
  useSyncExternalStore,
} from "react"

import {
  decisionateLanguageChangedEvent,
  getCurrentDecisionateLanguage,
  getServerDecisionateLanguage,
  getDecisionateText,
  toggleDecisionateLanguage,
  type DecisionateLanguage,
} from "@/lib/language"

type LanguageToggleProps = {
  className?: string
}

export function LanguageToggle({
  className = "",
}: LanguageToggleProps) {
  const language = useSyncExternalStore(
    subscribeToDecisionateLanguage,
    getCurrentDecisionateLanguage,
    getServerDecisionateLanguage
  )
  const nextLanguage: DecisionateLanguage =
    language === "fr" ? "en" : "fr"
  const label =
    nextLanguage === "fr"
      ? getDecisionateText(language, "switchToFrench")
      : getDecisionateText(language, "switchToEnglish")

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => toggleDecisionateLanguage(language)}
      className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-2.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:border-[var(--decisionate-brand-primary-ring)] hover:text-[var(--decisionate-brand-primary-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--decisionate-brand-primary-ring)] ${className}`}
    >
      <Languages size={16} aria-hidden="true" />
      <span aria-hidden="true">
        {nextLanguage.toUpperCase()}
      </span>
    </button>
  )
}

function subscribeToDecisionateLanguage(
  onLanguageChange: () => void
) {
  if (typeof window === "undefined") {
    return () => {}
  }

  window.addEventListener(
    decisionateLanguageChangedEvent,
    onLanguageChange
  )

  return () => {
    window.removeEventListener(
      decisionateLanguageChangedEvent,
      onLanguageChange
    )
  }
}
