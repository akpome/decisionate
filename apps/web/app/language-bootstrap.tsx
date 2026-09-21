"use client"

import { useEffect } from "react"

import {
  applyDecisionateLanguage,
  decisionateLanguageStorageKey,
  type DecisionateLanguage,
} from "@/lib/language"

export function LanguageBootstrap() {
  useEffect(() => {
    let language: DecisionateLanguage = "en"

    try {
      language =
        window.localStorage.getItem(
          decisionateLanguageStorageKey
        ) === "fr"
          ? "fr"
          : "en"
    } catch {
      language = "en"
    }

    applyDecisionateLanguage(language)
  }, [])

  return null
}
