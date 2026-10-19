const draftIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function decisionDraftId() {
  const url = new URL(window.location.href)
  const existing = url.searchParams.get("draft")
  if (existing && draftIdPattern.test(existing)) return existing.toLowerCase()
  const identity = crypto.randomUUID()
  url.searchParams.set("draft", identity)
  // Keep retry identity across reloads without storing any decision or evidence text.
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`)
  return identity
}

export function defaultDecisionTitle(identity: string, prefix = "Decision") {
  const suffix = ` (${identity})`
  return `${(prefix.trim() || "Decision").slice(0, 200 - suffix.length).trimEnd()}${suffix}`
}
