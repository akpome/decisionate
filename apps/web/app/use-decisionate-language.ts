"use client"

import {
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

export function useLandingText() {
  const language = useDecisionateLanguage()

  return {
    language,
    t: (source: string) =>
      getLandingText(language, source),
  }
}
