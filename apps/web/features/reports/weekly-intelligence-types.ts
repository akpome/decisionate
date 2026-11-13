import type { ReportAnomalyPoint } from "./types"

type Window = { start: string; end: string }
export type IntelligenceFinding = {
  id: string; title: string; observation: string; metric_ids: string[]; window: Window; previous_window: Window
  relevance: string; limitations: string[]; rank_basis: string; continuity: string; related_decision_id: number | null
  evidence: { current: number | null; previous: number | null; change: number | null; change_percent: number | null
    unusual_periods: ReportAnomalyPoint[]; assessment_grain: string; coverage: number[] }
}
export type WeeklyIntelligence = {
  version: string; as_of: string; reporting_timezone: string; summary: string; narrative_source: string
  findings: IntelligenceFinding[]; default_finding_count: number; prioritization: string
  investigations: { relationship_id: string; metric_ids: string[]; finding_ids: string[]; status: string
    summary: string; coefficient: number | null; lag: number; lag_unit: string; observations: number
    history_window: Window; limitations: string[] }[]
  recommendations: { id: string; finding_id: string; action: string; success_metric_id: string
    expected_direction: string; priority: string; limitations: string[]; related_decision_id: number | null }[]
  decisions: { id: number; title: string; status: string; owner_user_id: string; owner_name?: string; success_metric: string
    baseline: number | null; target: string | null; recorded_value: number | null; recorded_at: string | null
    observed_value: number | null; currency?: string | null; monitoring_period: Window | null
    review_date: string | null; assessment: string; recorded_outcome: string | null; limitation: string }[]
  quality: string[]; forecast_status: string
  sources: { dataset_id: number; dataset_label: string; date_column: string; latest_observation: string | null
    last_synced_at?: string | null; connection_status?: string; warnings: string[] }[]
}
