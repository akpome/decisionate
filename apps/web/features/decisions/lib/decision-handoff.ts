export function buildCreateDecisionHref({
  datasetId,
  metric,
  returnTo = "/dashboard/decisions",
}: {
  datasetId?: number
  metric?: string
  returnTo?: string
} = {}) {
  const params = new URLSearchParams({ returnTo })
  if (datasetId && Number.isInteger(datasetId) && datasetId > 0) {
    params.set("dataset", String(datasetId))
  }
  if (metric?.trim()) {
    params.set("metric", metric.trim())
  }
  return `/dashboard/decisions/new?${params.toString()}`
}
