import type { ReportScope } from "./types"

export const reportSourceTabs = [
  { href: "/reports", label: "Relationships report" },
  { href: "/reports/combined", label: "Combined metrics report" },
  { href: "/reports/dataset", label: "Single dataset report" },
] as const

export function reportPagePath(weekly = false, impact = false, scope: ReportScope = "multi", includeRelationships = true) {
  if (weekly) return "/weekly-reports"
  if (impact) return "/reports/impact"
  return scope === "single" ? "/reports/dataset" : includeRelationships ? "/reports" : "/reports/combined"
}

export function reportHistoryQuery(weekly = false, impact = false) {
  return weekly ? "workflow=weekly" : `workflow=instant&analysis_type=${impact ? "impact" : "metrics"}`
}
