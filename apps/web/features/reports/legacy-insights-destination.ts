export function legacyInsightsDestination(search: Record<string, string | string[] | undefined>) {
  const query = new URLSearchParams()
  for (const key of ["dataset", "metric", "report", "weekly", "run"]) {
    const value = search[key]
    if (typeof value === "string" && value) query.set(key, value)
  }
  const single = query.has("dataset") && !["report", "weekly", "run"].some(key => query.has(key))
  const path = single ? "/dashboard/reports/dataset" : "/dashboard/reports"
  return query.size ? `${path}?${query}` : path
}
