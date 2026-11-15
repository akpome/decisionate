export function buildCreateDecisionHref({
  datasetId,
  metric,
  returnTo = "/decisions",
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
  return `/decisions/new?${params.toString()}`
}
