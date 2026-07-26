"use client"

import {
  useEffect,
} from "react"

import {
  applyDecisionateTheme,
  decisionateThemeStorageKey,
  type DecisionateTheme,
} from "@/lib/theme"

export function ThemeBootstrap() {
  useEffect(() => {
    let theme: DecisionateTheme = "light"

    try {
      theme =
        window.localStorage.getItem(
          decisionateThemeStorageKey
        ) === "dark"
          ? "dark"
          : "light"
    } catch {
      theme = "light"
    }

    applyDecisionateTheme(theme)
  }, [])

  return null
}
