const tokenPattern = /^[\w-]{32,100}$/

function validToken(value: unknown): string {
  return typeof value === "string" && tokenPattern.test(value) ? value : ""
}

export function readSharedLinkLocation(browser: Pick<Window, "location" | "history">) {
  const url = new URL(browser.location.href)
  const supplied = url.searchParams.get("token")
  const state = browser.history.state
  if (supplied === null) {
    const saved = state?.decisionateSharedView
    const token = saved?.path === url.pathname + url.search ? validToken(saved.token) : ""
    return { search: url.search.slice(1), token }
  }

  const token = validToken(supplied.trim())
  url.searchParams.delete("token")
  const path = url.pathname + url.search
  try {
    // Keep access scoped to this history entry so refresh works without showing the token.
    browser.history.replaceState({ decisionateSharedView: token ? { path, token } : null }, "", path + url.hash)
  } catch {
    // A browser that rejects history updates can still display the original link.
  }
  return { search: url.search.slice(1), token }
}
