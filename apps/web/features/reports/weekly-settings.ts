import { editableDefinition, type BusinessReport, type ReportDefinition } from "./types"

export type WeeklySettings = {
  definition: ReportDefinition | null; enabled: boolean; reporting_timezone: string
  window: { start: string; end: string }; history_window: { start: string; end: string }
  current_report?: BusinessReport | null
}

export function weeklyDefinition(value: Partial<ReportDefinition>, history?: WeeklySettings["history_window"]): ReportDefinition {
  const copied = value.grain && value.grain !== "weekly"
    ? { ...value, lag: undefined, pair_directions: (value.pair_directions || []).map(pair => ({ ...pair, direction: "same_period" as const })) }
    : value
  return editableDefinition({ ...copied, grain: "weekly", scope: "multi", date_range: history || value.date_range,
    source_run_id: null, included_findings: null })
}

export function weeklyDeliveryIssue(report: BusinessReport | null, window?: WeeklySettings["window"]) {
  if (!report?.weekly_report || !window || report.window.start !== window.start || report.window.end !== window.end ||
    report.status === "ready" && report.dataset_count >= 2) return ""
  return `This weekly report cannot be sent: fewer than two datasets have usable data for ${window.start} to ${window.end}. Sync or upload data for that week and preview again. Use Analysis for historical data.`
}
