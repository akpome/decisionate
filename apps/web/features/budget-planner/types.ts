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
export function newBudgetDefinition(): BudgetDefinition {
  return { name: "Budget plan", outcome: blankSelection(), options: [1, 2].map(index => ({ ...blankSelection(), name: `Option ${index}` })), controls: [], budget: 0, currency: "CAD", start_date: nextMonday(), weeks: 4, comparable_spend_confirmed: false, business_context_confirmed: false }
}

export function budgetSetupIssue(definition: BudgetDefinition): string {
  if (!definition.name.trim()) return "Name this budget plan."
  if (!Number.isFinite(definition.budget) || definition.budget <= 0 || definition.budget > 1e12) return "Enter a total budget greater than zero, up to 1 trillion."
  if (Math.abs(Math.round(definition.budget * 100) / 100 - definition.budget) > 1e-6) return "Use no more than two decimal places for the budget."
  if (!/^[A-Z]{3}$/.test(definition.currency)) return "Choose the currency used by all spending options."
  const start = new Date(`${definition.start_date}T00:00:00Z`)
  if (!definition.start_date || !Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== definition.start_date || start.getUTCDay() !== 1) return "Choose a Monday for the plan to start."
  if (!Number.isInteger(definition.weeks) || definition.weeks < 1 || definition.weeks > 13) return "Choose between 1 and 13 whole planning weeks."
  const selectionIssue = (item: Selection, label: string) => !item.dataset_id ? `Choose a dataset for ${label}.`
    : !item.metric_key ? `Choose a metric for ${label}.` : !item.date_column ? `Choose a date column for ${label}.`
    : item.dimension_filter && !item.dimension_filter.values.length ? `Choose at least one dimension value for ${label}.` : ""
  const outcomeIssue = selectionIssue(definition.outcome, "the result to improve")
  if (outcomeIssue) return outcomeIssue
  if (definition.options.length < 2 || definition.options.length > 6) return "Include between 2 and 6 spending options."
  const names = new Set<string>()
  for (const [index, option] of definition.options.entries()) {
    const label = option.name.trim() || `spending option ${index + 1}`
    if (!option.name.trim()) return `Name spending option ${index + 1}.`
    if (names.has(label.toLowerCase())) return "Give each spending option a different name."
    names.add(label.toLowerCase())
    const issue = selectionIssue(option, label)
    if (issue) return issue
    if ([option.minimum, option.maximum].some(value => value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1e12))) return `Use a spending limit between zero and 1 trillion for ${label}.`
    if ((option.minimum ?? 0) > (option.maximum ?? Infinity)) return `Keep the minimum below the maximum for ${label}.`
    if (option.dataset_id === definition.outcome.dataset_id && option.metric_key === definition.outcome.metric_key) return "Choose a result metric different from your spending metrics."
    for (const other of definition.options.slice(0, index)) {
      if (option.dataset_id !== other.dataset_id || option.metric_key !== other.metric_key) continue
      const left = option.dimension_filter, right = other.dimension_filter
      if (option.date_column !== other.date_column || !left || !right || left.column !== right.column || left.values.some(value => right.values.includes(value))) return "Separate spending options using different values of the same dimension column, without overlap."
    }
  }
  for (const [index, control] of definition.controls.entries()) {
    const issue = selectionIssue(control, `business influence ${index + 1}`)
    if (issue) return issue
    if ([definition.outcome, ...definition.options].some(item => item.dataset_id === control.dataset_id && item.metric_key === control.metric_key)) return "Choose a business influence different from your spending and result metrics."
  }
  return ""
}
export function amount(value: number, currency?: string | null) {
  return new Intl.NumberFormat(undefined, currency ? { style: "currency", currency, maximumFractionDigits: 2 } : { maximumFractionDigits: 1 }).format(value)
}
