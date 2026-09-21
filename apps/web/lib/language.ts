export const decisionateLanguageStorageKey =
  "decisionate:language"
export const decisionateLanguageChangedEvent =
  "decisionate:language-changed"

export type DecisionateLanguage =
  | "en"
  | "fr"

export type DecisionateLanguageChange = {
  language: DecisionateLanguage
}

const languageLocales: Record<
  DecisionateLanguage,
  string
> = {
  en: "en-CA",
  fr: "fr-CA",
}

const translations = {
  en: {
    switchToEnglish: "Switch to English",
    switchToFrench: "Passer au français",
    workspace: "Workspace",
    dashboard: "Dashboard",
    dashboards: "Dashboards",
    decisions: "Decisions",
    actionNeeded: "Action Needed",
    workspaceAccess: "Workspace Access",
    analysis: "Analysis",
    insights: "Insights",
    forecasts: "Forecasts",
    reports: "Reports",
    alerts: "Alerts",
    relationships: "Relationships",
    data: "Data",
    datasets: "Datasets",
    entityMatching: "Entity Matching",
    connections: "Connections",
    manage: "Manage",
    settings: "Settings",
    billing: "Billing",
    support: "Support",
    helpSupport: "Help & Support",
    account: "Account",
    businessWorkspace: "Business workspace",
    portal: "portal",
    dashboardNavigation: "Dashboard navigation",
    closeNavigation: "Close dashboard navigation",
    openNavigation: "Open dashboard navigation",
    closeNavigationShort: "Close navigation",
    openNavigationShort: "Open navigation",
    reload: "Reload",
    dismiss: "Dismiss",
  },
  fr: {
    switchToEnglish: "Passer à l'anglais",
    switchToFrench: "Passer au français",
    workspace: "Espace de travail",
    dashboard: "Tableau de bord",
    dashboards: "Tableaux de bord",
    decisions: "Décisions",
    actionNeeded: "Action requise",
    workspaceAccess: "Accès à l'espace de travail",
    analysis: "Analyse",
    insights: "Analyses",
    forecasts: "Prévisions",
    reports: "Rapports",
    alerts: "Alertes",
    relationships: "Relations",
    data: "Données",
    datasets: "Jeux de données",
    entityMatching: "Appariement d'entités",
    connections: "Connexions",
    manage: "Gestion",
    settings: "Paramètres",
    billing: "Facturation",
    support: "Assistance",
    helpSupport: "Aide et assistance",
    account: "Compte",
    businessWorkspace: "Espace de travail professionnel",
    portal: "portail",
    dashboardNavigation: "Navigation du tableau de bord",
    closeNavigation: "Fermer la navigation du tableau de bord",
    openNavigation: "Ouvrir la navigation du tableau de bord",
    closeNavigationShort: "Fermer la navigation",
    openNavigationShort: "Ouvrir la navigation",
    reload: "Recharger",
    dismiss: "Fermer",
  },
} as const

export type DecisionateTranslationKey =
  keyof typeof translations.en

export function getCurrentDecisionateLanguage(): DecisionateLanguage {
  if (typeof document === "undefined") {
    return "en"
  }

  return document.documentElement.lang
    .toLowerCase()
    .startsWith("fr")
    ? "fr"
    : "en"
}

export function applyDecisionateLanguage(
  language: DecisionateLanguage
) {
  if (typeof document === "undefined") {
    return
  }

  document.documentElement.lang =
    languageLocales[language]

  try {
    window.localStorage.setItem(
      decisionateLanguageStorageKey,
      language
    )
  } catch {
    // Storage can be unavailable in strict privacy contexts.
  }

  window.dispatchEvent(
    new CustomEvent<DecisionateLanguageChange>(
      decisionateLanguageChangedEvent,
      {
        detail: { language },
      }
    )
  )
}

export function toggleDecisionateLanguage(
  currentLanguage = getCurrentDecisionateLanguage()
) {
  const nextLanguage =
    currentLanguage === "fr" ? "en" : "fr"

  applyDecisionateLanguage(nextLanguage)

  return nextLanguage
}

export function getDecisionateText(
  language: DecisionateLanguage,
  key: DecisionateTranslationKey
) {
  return translations[language][key]
}

export function getServerDecisionateLanguage(): DecisionateLanguage {
  return "en"
}
