import type { ReportScope } from "./types"

export const reportSourceTabs = [
  { href: "/dashboard/reports", label: "Relationships report" },
  { href: "/dashboard/reports/combined", label: "Combined metrics report" },
  { href: "/dashboard/reports/dataset", label: "Single dataset report" },
] as const

export function reportPagePath(weekly = false, impact = false, scope: ReportScope = "multi", includeRelationships = true) {
  if (weekly) return "/dashboard/reports/weekly"
  if (impact) return "/dashboard/reports/impact"
  return scope === "single" ? "/dashboard/reports/dataset" : includeRelationships ? "/dashboard/reports" : "/dashboard/reports/combined"
}

export function reportHistoryQuery(weekly = false, impact = false) {
  return weekly ? "workflow=weekly" : `workflow=instant&analysis_type=${impact ? "impact" : "metrics"}`
}
