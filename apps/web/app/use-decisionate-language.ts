"use client"

import {
  useCallback,
  useSyncExternalStore,
} from "react"

import {
  decisionateLanguageChangedEvent,
  getCurrentDecisionateLanguage,
  getLandingText,
  getServerDecisionateLanguage,
} from "@/lib/language"

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

export function useDecisionateLanguage() {
  return useSyncExternalStore(
    subscribeToDecisionateLanguage,
    getCurrentDecisionateLanguage,
    getServerDecisionateLanguage
  )
}

export function useDecisionateText() {
  const language = useDecisionateLanguage()
  const t = useCallback(
    (source: string) => getLandingText(language, source),
    [language]
  )

  return {
    language,
    t,
  }
}

export const useLandingText = useDecisionateText
