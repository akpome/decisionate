import { editableDefinition, type ReportDefinition } from "./types"

export type WeeklySettings = {
  definition: ReportDefinition | null; enabled: boolean; reporting_timezone: string
  window: { start: string; end: string }; history_window: { start: string; end: string }
}

export function weeklyDefinition(value: Partial<ReportDefinition>, history?: WeeklySettings["history_window"]): ReportDefinition {
  const copied = value.grain && value.grain !== "weekly"
    ? { ...value, lag: undefined, pair_directions: (value.pair_directions || []).map(pair => ({ ...pair, direction: "same_period" as const })) }
    : value
  return editableDefinition({ ...copied, grain: "weekly", scope: "multi", date_range: history || value.date_range,
    source_run_id: null, included_findings: null })
}
