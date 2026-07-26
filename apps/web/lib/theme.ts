export const decisionateThemeStorageKey =
  "decisionate:theme"
export const decisionateThemeChangedEvent =
  "decisionate:theme-changed"

export type DecisionateTheme =
  "light" | "dark"

export type DecisionateThemeChange = {
  theme: DecisionateTheme
}

export function getCurrentDecisionateTheme(): DecisionateTheme {
  if (typeof document === "undefined") {
    return "light"
  }

  return document.documentElement.dataset.theme === "dark"
    ? "dark"
    : "light"
}

export function applyDecisionateTheme(
  theme: DecisionateTheme
) {
  if (typeof document === "undefined") {
    return
  }

  const root = document.documentElement

  root.dataset.theme = theme
  root.classList.toggle(
    "dark",
    theme === "dark"
  )
  root.style.colorScheme = theme
  updateThemeColorMeta(theme)

  try {
    window.localStorage.setItem(
      decisionateThemeStorageKey,
      theme
    )
  } catch {
    // Storage can be unavailable in strict privacy contexts.
  }

  window.dispatchEvent(
    new CustomEvent<DecisionateThemeChange>(
      decisionateThemeChangedEvent,
      {
        detail: {
          theme,
        },
      }
    )
  )
}

export function toggleDecisionateTheme(
  currentTheme = getCurrentDecisionateTheme()
) {
  const nextTheme =
    currentTheme === "dark" ? "light" : "dark"

  applyDecisionateTheme(nextTheme)

  return nextTheme
}

function updateThemeColorMeta(
  theme: DecisionateTheme
) {
  const themeColor =
    theme === "dark" ? "#020617" : "#4f46e5"
  const meta =
    document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]'
    )

  if (!meta) {
    const themeMeta =
      document.createElement("meta")

    themeMeta.name = "theme-color"
    themeMeta.content = themeColor
    document.head.appendChild(themeMeta)
    return
  }

  meta.content = themeColor
}
