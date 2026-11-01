import type { DimensionFilter } from "@/lib/api"

export type AmountSelection = {
  dataset_id: number; metric_key: string; date_column: string
  records: "daily" | "monthly" | "transactions"; dimension_filter?: DimensionFilter
}
export type PerformanceItem = { name: string; revenue: AmountSelection; costs: AmountSelection[] }
export type PerformanceDefinition = {
  kind: "return" | "profit"; currency: string; date_range: { start: string; end: string }
  items: PerformanceItem[]; group_column: string | null
  revenue_basis: "assigned_sales" | "platform_reported"; amounts_confirmed: boolean
}
export type PerformanceRow = {
  name: string; revenue: number | null; costs: number | null; return_per_dollar: number | null
  money_left: number | null; margin_percent: number | null; ready: boolean; issues: string[]
}
export type PerformanceResult = {
  analysis_id?: string; decision_id?: number; name: string; generated_at: string
  status: "ready" | "partial" | "needs_data"; definition: PerformanceDefinition
  rows: PerformanceRow[]; headline: string; next_action: string; winner: string | null; basis: string; limitations: string[]
}
export type RecordSource = { dataset_id: number; date_column: string; dimension_filter?: DimensionFilter }
export type RetentionDefinition = {
  kind: "retention"; source: RecordSource; customer_column: string; order_column: string
  date_range: { start: string; end: string }; return_days: 30 | 60 | 90; amounts_confirmed: boolean
}
export type ConversionDefinition = {
  kind: "conversion"; source: RecordSource; date_range: { start: string; end: string }
  records: "daily" | "monthly" | "transactions"; steps: { name: string; metric_key: string }[]
  group_column: string | null; amounts_confirmed: boolean
}
export type CashFlowDefinition = {
  kind: "cashflow"; source: RecordSource; incoming_metric: string; outgoing_metric: string
  outgoing_source?: RecordSource | null
  start_date: string; weeks: 4 | 8 | 13 | 26; currency: string; opening_balance: number; reserve: number
  income_change_percent: number; cost_change_percent: number; collection_delay_days: number; amounts_confirmed: boolean
}
export type GrowthDefinition = RetentionDefinition | ConversionDefinition | CashFlowDefinition
export type ToolDefinition = PerformanceDefinition | GrowthDefinition
export type ToolKind = ToolDefinition["kind"]
export type ValueFormat = "count" | "percent" | "money" | "text"
export type GrowthResult = {
  analysis_id?: string; decision_id?: number; name: string; generated_at: string
  status: "ready" | "partial" | "needs_data"; definition: GrowthDefinition; period: { start: string; end: string }
  rows: ({ name: string; ready: boolean; issues: string[] } & Record<string, string | number | null | boolean | string[]>)[]
  columns: { key: string; label: string; format: ValueFormat }[]
  highlights: { label: string; value: number | string | null; format: ValueFormat }[]
  chart: { label: string; format: ValueFormat; points: { name: string; value: number; baseline?: number }[] } | null
  headline: string; next_action: string; limitations: string[]
}
export type ToolResult = PerformanceResult | GrowthResult
export const toolLabels: Record<ToolKind, string> = { return: "Return on spend", profit: "Profitability", retention: "Customer retention", conversion: "Sales conversion", cashflow: "Cash flow planning" }
export const isMoneyDefinition = (value: ToolDefinition): value is PerformanceDefinition => value.kind === "return" || value.kind === "profit"
export const blankAmount = (): AmountSelection => ({ dataset_id: 0, metric_key: "", date_column: "", records: "daily" })
export const blankItem = (name: string): PerformanceItem => ({ name, revenue: blankAmount(), costs: [blankAmount()] })
export function newPerformance(kind: ToolKind): ToolDefinition {
  const source = { dataset_id: 0, date_column: "" }, date_range = { start: "", end: "" }
  if (kind === "retention") return { kind, source, date_range, customer_column: "", order_column: "", return_days: 90, amounts_confirmed: false }
  if (kind === "conversion") return { kind, source, date_range, records: "daily", group_column: null, steps: [{ name: "Enquiries", metric_key: "" }, { name: "Sales", metric_key: "" }], amounts_confirmed: false }
  if (kind === "cashflow") return { kind, source, outgoing_source: null, incoming_metric: "", outgoing_metric: "", start_date: "", weeks: 13, currency: "CAD", opening_balance: 0, reserve: 0, income_change_percent: 0, cost_change_percent: 0, collection_delay_days: 0, amounts_confirmed: false }
  return { kind, currency: "CAD", date_range: { start: "", end: "" }, items: [blankItem("Business")],
    group_column: null, revenue_basis: "assigned_sales", amounts_confirmed: false }
}
export function missingSetup(value: ToolDefinition) {
  if (!isMoneyDefinition(value)) {
    if (value.kind === "cashflow") {
      if (!value.start_date) return "Choose when the cash plan starts."
      if (!value.incoming_metric || !value.outgoing_metric) return "Choose the expected money in and money out columns."
      if (value.outgoing_source) {
        if (!value.outgoing_source.dataset_id || !value.outgoing_source.date_column) return "Choose the outgoing payments dataset and its payment date column."
        if (value.source.dataset_id === value.outgoing_source.dataset_id) return "Choose different datasets, or use Both in the same dataset."
        if (value.outgoing_source.dimension_filter && !value.outgoing_source.dimension_filter.values.length) return "Choose a value for the outgoing payments filter."
      } else if (value.incoming_metric === value.outgoing_metric) return "Choose separate amounts for money in and money out."
    } else {
      if (!value.date_range.start || !value.date_range.end) return "Choose the dates to compare."
      if (value.date_range.start > value.date_range.end) return "The end date must be on or after the start date."
    }
    if (!value.source.dataset_id || !value.source.date_column) return "Choose a dataset and its date column."
    if (value.source.dimension_filter && !value.source.dimension_filter.values.length) return "Choose a value for the selected filter."
    if (value.kind === "retention") {
      if (!value.customer_column || !value.order_column) return "Choose the customer ID and purchase ID columns."
      if (new Set([value.customer_column, value.order_column, value.source.date_column]).size !== 3) return "Customer ID, purchase ID and date need different columns."
    }
    if (value.kind === "conversion") {
      if (value.steps.some(step => !step.name.trim() || !step.metric_key)) return "Name each step and choose its count."
      if (new Set(value.steps.map(step => step.metric_key)).size !== value.steps.length) return "Choose a different count for each step."
      if (new Set(value.steps.map(step => step.name.trim().toLowerCase())).size !== value.steps.length) return "Give each step a different name."
    }
    return value.amounts_confirmed ? "" : "Confirm the selected records below."
  }
  if (!value.date_range.start || !value.date_range.end) return "Choose the dates to compare."
  if (value.date_range.start > value.date_range.end) return "The end date must be on or after the start date."
  if (value.items.some(item => !item.name.trim())) return "Name each comparison."
  if (value.items.some(item => [item.revenue, ...item.costs].some(source => !source.dataset_id || !source.metric_key || !source.date_column))) return "Choose a dataset, date column and amount for revenue and costs."
  if (value.items.some(item => [item.revenue, ...item.costs].some(source => source.dimension_filter && !source.dimension_filter.values.length))) return "Choose a value for each selected filter."
  if (!value.amounts_confirmed) return "Confirm that you have checked these figures."
  return ""
}
export const performancePath = (kind: ToolKind) => `/dashboard/reports/${{ return: "returns", profit: "profitability", retention: "retention", conversion: "conversion", cashflow: "cash-flow" }[kind]}`
export function sameDatasetLayout(value: ToolDefinition) {
  if (value.kind === "cashflow") return !value.outgoing_source
  if (!isMoneyDefinition(value)) return true
  if (value.items.length !== 1) return false
  const first = value.items[0].revenue
  return value.items[0].costs.every(source => source.dataset_id === first.dataset_id && source.date_column === first.date_column && source.records === first.records && JSON.stringify(source.dimension_filter) === JSON.stringify(first.dimension_filter))
}
