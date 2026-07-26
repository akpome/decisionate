"use client"

import {
  Moon,
  Sun,
} from "lucide-react"
import {
  useSyncExternalStore,
} from "react"

import {
  decisionateThemeChangedEvent,
  getCurrentDecisionateTheme,
  toggleDecisionateTheme,
  type DecisionateTheme,
} from "@/lib/theme"

type ThemeToggleProps = {
  className?: string
}

export function ThemeToggle({
  className = "",
}: ThemeToggleProps) {
  const themeMode =
    useSyncExternalStore(
      subscribeToDecisionateTheme,
      getCurrentDecisionateTheme,
      getServerDecisionateTheme
    )
  const isDarkTheme =
    themeMode === "dark"

  return (
    <button
      type="button"
      aria-label={
        isDarkTheme
          ? "Switch to light theme"
          : "Switch to dark theme"
      }
      aria-pressed={isDarkTheme}
      title={
        isDarkTheme
          ? "Switch to light theme"
          : "Switch to dark theme"
      }
      onClick={() =>
        toggleDecisionateTheme(themeMode)
      }
      className={`flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 shadow-sm transition hover:border-[var(--decisionate-brand-primary-ring)] hover:text-[var(--decisionate-brand-primary-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--decisionate-brand-primary-ring)] ${className}`}
    >
      {isDarkTheme ? (
        <Sun size={18} />
      ) : (
        <Moon size={18} />
      )}
    </button>
  )
}

function subscribeToDecisionateTheme(
  onThemeChange: () => void
) {
  if (typeof window === "undefined") {
    return () => {}
  }

  window.addEventListener(
    decisionateThemeChangedEvent,
    onThemeChange
  )

  return () => {
    window.removeEventListener(
      decisionateThemeChangedEvent,
      onThemeChange
    )
  }
}

function getServerDecisionateTheme(): DecisionateTheme {
  return "light"
}
