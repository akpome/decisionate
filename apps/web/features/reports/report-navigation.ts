import type { ReportScope } from "./types"

export const reportSourceTabs = [
  { href: "/business-analysis", label: "Multi-dataset report" },
  { href: "/business-analysis/dataset", label: "Single dataset report" },
] as const

export function reportPagePath(weekly = false, impact = false, scope: ReportScope = "multi") {
  if (weekly) return "/weekly-reports"
  if (impact) return "/business-analysis/impact"
  return scope === "single" ? "/business-analysis/dataset" : "/business-analysis"
}

export function reportHistoryQuery(weekly = false, impact = false) {
  return weekly ? "workflow=weekly" : `workflow=instant&analysis_type=${impact ? "impact" : "metrics"}`
}
