import type { DimensionFilter } from "@/lib/api"

export type Selection = { dataset_id: number; metric_key: string; date_column: string; dimension_filter?: DimensionFilter; data_grain: "daily" | "weekly" }
export type SpendingOption = Selection & { name: string; minimum?: number; maximum?: number }
export type BudgetDefinition = { name: string; outcome: Selection; options: SpendingOption[]; controls: Selection[]; budget: number; currency: string; start_date: string; weeks: number; comparable_spend_confirmed: boolean; business_context_confirmed: boolean }
export type BudgetResult = { status: "ready" | "needs_evidence"; checks: string[]; limitations: string[]; definition: BudgetDefinition; generated_at: string; engine_version: string;
  plan_id?: string; decision_id?: number; history: { start: string; end: string; weeks: number } | null;
  outcome: { label: string; dataset_label: string; currency: string | null } | null;
  allocations: { name: string; current: number; suggested: number; minimum: number; maximum: number; reason?: string }[];
  estimate: { additional_result: number; lower: number; upper: number } | null }
export const blankSelection = (): Selection => ({ dataset_id: 0, metric_key: "", date_column: "", data_grain: "daily" })
export function nextMonday(now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  date.setDate(date.getDate() + (8 - date.getDay()) % 7)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}
export function missingSelection(definition: BudgetDefinition) {
  return [definition.outcome, ...definition.options, ...definition.controls].some(item => !item.dataset_id || !item.metric_key || !item.date_column || item.dimension_filter && !item.dimension_filter.values.length)
}
export function amount(value: number, currency?: string | null) {
  return new Intl.NumberFormat(undefined, currency ? { style: "currency", currency, maximumFractionDigits: 2 } : { maximumFractionDigits: 1 }).format(value)
}
