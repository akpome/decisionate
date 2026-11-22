import { formatReportValue } from "@/features/reports/types"

export const roles = ["input", "output"] as const
export type Role = typeof roles[number]
type Period = {start: string; end: string}
export type MetricReview = {
  status: "scheduled" | "waiting" | "ready"; summary: string
  plan: {start: string; review: string; timezone: string; report_id: string | null; lag_days: number; suggested_review?: string} & Record<Role, {
    label: string; dataset_label: string; direction: "increase" | "decrease"; change: number; unit: "percent" | "amount"
    currency: string | null; before: Period; after: Period; date_column: string; filter: {column: string; values: (string | null)[]} | null
  }>
  checks: Partial<Record<Role, {baseline: number | null; target: number | null; actual: number | null; status: string}>>
}
export function readMetricReview(record: object) {
  return (record as {metric_review?: MetricReview | null}).metric_review
}

export function MetricReviewSummary({review}: {review: MetricReview}) {
  return <section className="space-y-4" aria-label="Action and result">
    <p className="text-sm font-medium">{review.summary}</p>
    <div className="grid gap-4 sm:grid-cols-2">{roles.map(role => {
      const target = review.plan[role], check = review.checks[role]
      const format = (n?: number | null) => n == null ? "Not available" : formatReportValue(n, target.currency)
      return <div key={role} className="min-w-0 space-y-2 border-t py-3">
        <h3 className="font-semibold">{role === "input" ? "Planned action" : "Expected result"}</h3>
        <p className="break-words text-sm">{target.direction === "increase" ? "Increase" : "Decrease"} {target.label} by at least {target.unit === "percent" ? target.change + "%" : format(target.change)}</p>
        <p className="text-xs text-gray-600">{target.dataset_label} · {target.date_column}{target.filter && " · " + target.filter.column + ": " + target.filter.values.map(v => v ?? "Missing").join(", ")}</p>
        <dl className="space-y-1 text-sm">
          <div><dt className="inline">Before ({target.before.start} to {target.before.end}): </dt><dd className="inline font-medium">{format(check?.baseline)}</dd></div>
          <div><dt className="inline">Target: </dt><dd className="inline font-medium">{format(check?.target)}</dd></div>
          <div><dt className="inline">Review period: </dt><dd className="inline">{target.after.start} to {target.after.end}</dd></div>
          {review.status !== "scheduled" && <div><dt className="inline">Actual: </dt><dd className="inline font-medium">{format(check?.actual)} · {check?.status === "met" ? "Target met" : check?.status === "missed" ? "Target not met" : "Waiting for data"}</dd></div>}
        </dl>
        {check?.baseline == null && <p className="text-xs text-amber-800">The baseline needs records for every day in the before period.</p>}
      </div>
    })}</div>
    {review.plan.lag_days > 0 && <p className="text-sm">The source report suggests a {review.plan.lag_days}-day delay. The result window starts after that delay. Suggested review: {review.plan.suggested_review}.</p>}
    {review.status === "ready" && <p className="text-sm text-gray-600">These checks show whether the numbers reached your targets, not whether the action caused the result.</p>}
  </section>
}
