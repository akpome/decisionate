const draftIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const generatedWeeklyNamePattern = /^(?:Weekly )*Report \([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\)$/i

export function weeklyReportName(name?: string | null) {
  return !name?.trim() || generatedWeeklyNamePattern.test(name.trim()) ? "Weekly Business Report" : name
}

export function defaultReportName(identity: string = crypto.randomUUID()) {
  return `Report (${identity})`
}

export function isDefaultReportName(name: string) {
  return name.startsWith("Report (") && name.endsWith(")") && draftIdPattern.test(name.slice(8, -1))
}

export function reportDraftName() {
  const url = new URL(window.location.href)
  const existing = url.searchParams.get("draft")
  const identity = existing && draftIdPattern.test(existing) ? existing.toLowerCase() : crypto.randomUUID()
  if (existing !== identity) {
    url.searchParams.set("draft", identity)
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`)
  }
  return defaultReportName(identity)
}
