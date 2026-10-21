export function historicalEvidenceHref(runId: string, resultId?: string) {
  const query = new URLSearchParams({ run: runId })
  if (resultId) query.set("result", resultId)
  return `/dashboard/reports/evidence?${query}`
}

export function legacyRelationshipDestination(search: Record<string, string | string[] | undefined>) {
  const query = new URLSearchParams()
  for (const key of ["run", "result"]) {
    const value = search[key]
    if (typeof value === "string" && value) query.set(key, value)
  }
  return query.size ? `/dashboard/reports/evidence?${query}` : "/dashboard/reports"
}
