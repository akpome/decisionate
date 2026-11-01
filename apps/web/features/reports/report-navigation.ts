import type { ReportScope } from "./types"

export function reportPagePath(weekly = false, impact = false, scope: ReportScope = "multi") {
  if (weekly) return "/dashboard/reports/weekly"
  if (impact) return "/dashboard/reports/impact"
  return scope === "single" ? "/dashboard/reports/dataset" : "/dashboard/reports"
}

export function reportHistoryQuery(weekly = false, impact = false) {
  return weekly ? "workflow=weekly" : `workflow=instant&analysis_type=${impact ? "impact" : "metrics"}`
}
