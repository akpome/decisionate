import type { ChartScale } from "./chart-scale-control"
import type { ImpactAnalysis } from "./impact-types"

export function impactChartTrends(trend: ImpactAnalysis["trend"], scale: ChartScale, period: string) {
  // One denominator preserves the estimated gap and stays fixed when the visible history changes.
  const baseline = trend.find(item => item.after_change && Number.isFinite(item.without_change) && item.without_change > 0) ?? null
  let overflow = false
  const value = (raw: number) => {
    if (!Number.isFinite(raw)) return null
    const result = scale === "actual" ? raw : baseline ? raw / baseline.without_change * 100 : null
    if (result !== null && !Number.isFinite(result)) { overflow = true; return null }
    return result
  }
  const rows = trend.filter(item => period === "all" || item.after_change).map(item => ({
    period: item.period, after_change: item.after_change,
    actual: value(item.actual), without_change: item.after_change ? value(item.without_change) : null,
    raw_actual: Number.isFinite(item.actual) ? item.actual : null,
    raw_without_change: item.after_change && Number.isFinite(item.without_change) ? item.without_change : null,
  }))
  return { baseline, rows, overflow }
}
