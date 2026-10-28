import type { ReportMetric } from "./types"

const colors = ["#2563eb", "#059669", "#dc2626", "#9333ea", "#d97706", "#0891b2", "#db2777", "#4f46e5", "#4d7c0f", "#475569", "#b45309", "#0f766e", "#be123c", "#7e22ce", "#0369a1", "#15803d", "#c2410c", "#a21caf", "#4338ca", "#0e7490", "#a16207", "#6d28d9", "#9f1239", "#166534", "#334155"]

export type IndexedTrendSeries = {
  key: string; metric: ReportMetric; label: string; color: string; dash: string | undefined
  baseline: number | null; points: number; rawPoints: number; overflow: number
}
export type IndexedTrendRow = { period: string; indexed: Record<string, number | null>; raw: Record<string, number | null> }

export function indexedMetricTrends(metrics: ReportMetric[]) {
  const series: IndexedTrendSeries[] = metrics.map((metric, index) => ({
    key: `metric_${index}`, metric, label: `${metric.dataset_label} / ${metric.label}`, color: colors[index % colors.length],
    dash: index < 8 ? undefined : index < 16 ? "7 3" : "2 3", baseline: null, points: 0, rawPoints: 0, overflow: 0,
  }))
  const points = metrics.map(metric => new Map((metric.trend ?? []).map(point => [point.period, Number.isFinite(point.value) ? point.value : null])))
  const periods = [...new Set(points.flatMap(values => [...values.keys()]))].sort()
  const available = series.filter((_, index) => [...points[index].values()].some(value => value !== null && value > 0))
  const availableKeys = new Set(available.map(item => item.key))
  const excluded = series.filter(item => !availableKeys.has(item.key))
  // A shared positive denominator preserves comparable dates and the direction of changes.
  const baselinePeriod = available.length ? periods.find(period => available.every(item => {
    const value = points[series.indexOf(item)].get(period)
    return value !== undefined && value !== null && value > 0
  })) ?? null : null
  if (baselinePeriod) for (const item of available) item.baseline = points[series.indexOf(item)].get(baselinePeriod)!
  const rows: IndexedTrendRow[] = periods.map(period => {
    const raw: IndexedTrendRow["raw"] = {}, indexed: IndexedTrendRow["indexed"] = {}
    series.forEach((item, index) => {
      const value = points[index].get(period) ?? null
      const result = value !== null && item.baseline !== null ? value / item.baseline * 100 : null
      raw[item.key] = value
      if (value !== null) item.rawPoints++
      indexed[item.key] = result !== null && Number.isFinite(result) ? result : null
      if (indexed[item.key] !== null) item.points++
      if (result !== null && !Number.isFinite(result)) item.overflow++
    })
    return { period, raw, indexed }
  })
  return { series, plotted: baselinePeriod ? available : [], actual: series.filter(item => item.rawPoints > 0), excluded, baselinePeriod, rows }
}
