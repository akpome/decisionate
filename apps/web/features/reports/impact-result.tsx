import { CheckCircle2, CircleHelp } from "lucide-react"
import type { ImpactAnalysis } from "./impact-types"
import { formatReportValue } from "./types"

export function ImpactResult({ analysis, compact = false }: { analysis?: ImpactAnalysis | null; compact?: boolean }) {
  if (!analysis) return null
  const estimate = analysis.estimate
  const value = (number: number) => formatReportValue(number, analysis.outcome?.currency)
  const signed = (number: number) => `${number > 0 ? "+" : ""}${value(number)}`
  const period = { daily: "day", weekly: "week", monthly: "month" }[analysis.grain] || "period"
  const timingUnit = ({ daily: "day", weekly: "week", monthly: "month", quarterly: "quarter" } as Record<string, string>)[analysis.timing?.grain || ""] || "period"
  const scope = estimate?.is_total ? analysis.after_periods != null ? `Across ${analysis.after_periods} complete ${period}${analysis.after_periods === 1 ? "" : "s"} after the change` : "Across the measured time after the change" : `Average difference per ${period}, not a total`
  const hasRange = estimate && Number.isFinite(estimate.lower) && Number.isFinite(estimate.upper)
  return <section aria-label="Business change result" className="min-w-0 space-y-4 border-y border-gray-200 py-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-semibold">Did your change help?</h3><span className="text-xs font-medium text-gray-600">{estimate ? "Estimated impact" : "Not enough reliable evidence"}</span></div>
    <p className="break-words text-sm text-gray-600">{analysis.change} / Implemented {analysis.change_date}</p>
    <p className="break-words text-xl font-semibold">{analysis.headline}</p>
    {analysis.timing?.status === "supported" && <div className="space-y-1 text-sm leading-6 text-gray-600">
      <p className="break-words">Earlier analysis: {analysis.timing.lag ? <>{analysis.timing.driver_label} led the result by {analysis.timing.lag} {timingUnit}{analysis.timing.lag === 1 ? "" : "s"}.</>
        : <>{analysis.timing.driver_label} and the result moved together in the same grouped period.</>}</p>
      {analysis.timing.expected_response_date && <p>Suggested response window: around {analysis.timing.expected_response_date}. Early results remain included.</p>}
      {analysis.timing.later_period_start && analysis.timing.later_period_start !== analysis.timing.expected_response_date && <p>First complete later period starts {analysis.timing.later_period_start}.</p>}
      {analysis.early_periods != null && <p>{analysis.early_periods} early and {analysis.later_periods} later complete {period}s checked.</p>}
    </div>}
    {estimate && analysis.baseline && <p className="break-words text-sm leading-6 text-gray-600">{analysis.baseline.message}</p>}
    {estimate ? <div className="space-y-2 border-l-2 border-blue-600 pl-4">
      <p className="text-sm font-medium text-gray-700">Estimated change in {analysis.outcome?.label || "your result"}</p>
      <p className={`break-words text-2xl font-semibold tabular-nums ${estimate.verdict === "helped" ? "text-green-800" : estimate.verdict === "hurt" ? "text-red-800" : "text-gray-950"}`}>{signed(estimate.effect)}</p>
      <p className="text-sm text-gray-600">{scope}.</p>
      {hasRange && <p className="text-sm leading-6 text-gray-700">Estimated range: {signed(estimate.lower)} to {signed(estimate.upper)}.</p>}
      {estimate.verdict === "unclear" && <p className="text-sm leading-6 text-amber-900">The range includes no change. We cannot yet say this helped or hurt.</p>}
    </div> : <p className="break-words text-sm leading-6 text-gray-700">{analysis.summary}</p>}
    {!compact && estimate && <dl className="grid min-w-0 gap-4 border-y border-gray-200 py-4 sm:grid-cols-2">
      {[["Actual result", value(estimate.actual)], ["Without the change (estimated)", value(estimate.expected_without_change)]].map(([label, amount]) => <div key={label} className="min-w-0"><dt className="text-sm text-gray-600">{label}</dt><dd className="mt-1 break-words text-lg font-semibold tabular-nums">{amount}</dd></div>)}
    </dl>}
    {estimate && Boolean(analysis.phases?.length) && <div className="space-y-3">
      <h4 className="text-sm font-semibold">Early and later results</h4>
      <dl className="grid min-w-0 gap-4 sm:grid-cols-2">{analysis.phases!.map(phase => <div key={phase.phase} className="min-w-0 border-t border-gray-200 pt-3">
        <dt className="text-sm font-medium">{phase.phase === "early" ? "Early results" : "Later results"}</dt>
        <dd className="mt-1 break-words text-lg font-semibold tabular-nums">{signed(phase.effect)}{!estimate.is_total && <span className="text-sm font-normal"> per {period}</span>}</dd>
        <dd className="mt-1 text-xs leading-5 text-gray-600">{phase.start} to {phase.end} / {phase.observations} {period}s</dd>
        <dd className="mt-1 break-words text-sm text-gray-600">Estimated range: {signed(phase.lower)} to {signed(phase.upper)}.</dd>
      </div>)}</dl>
      <p className="text-xs leading-5 text-gray-600">These estimates use the same earlier baseline. They are not separate proof of cause and effect.</p>
    </div>}
    {estimate?.worthwhile_change != null && <p className="text-sm text-gray-700">Minimum worthwhile improvement: {value(estimate.worthwhile_change)}. {estimate.worthwhile_result === "likely" ? "The estimate clears your target." : estimate.worthwhile_result === "unlikely" ? "The estimate does not reach your target." : "It is not clear whether the benefit reaches your target."}</p>}
    <div><h4 className="text-sm font-semibold">What to do next</h4><ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-gray-700">{analysis.next_steps.map(text => <li key={text}>{text}</li>)}</ul></div>
    <p className="text-xs leading-5 text-gray-600">{estimate ? "An estimate, not a guarantee. Other business changes can affect the result." : "No impact amount has been estimated."}</p>
    {!compact && <details className="min-w-0 border-t border-gray-200 pt-3 text-sm"><summary className="cursor-pointer font-medium">What we checked and what could change the answer</summary>
      <ul className="mt-3 space-y-3">{analysis.checks.map(check => <li key={check.key} className="flex items-start gap-2">{check.passed ? <CheckCircle2 size={16} className="mt-1 shrink-0 text-green-700" aria-hidden="true" /> : <CircleHelp size={16} className="mt-1 shrink-0 text-amber-700" aria-hidden="true" />}<span className="min-w-0 break-words">{check.message}</span></li>)}</ul>
      <p className="mt-3 text-xs text-gray-600">History checked: {analysis.window.start} to {analysis.window.end}{analysis.before_periods != null && <> / {analysis.before_periods} complete {period}s before, {analysis.after_periods} after.</>}</p>
      {estimate && <p className="mt-3 text-sm leading-6 text-gray-600">{analysis.summary}</p>}
      {analysis.comparison && <p className="mt-3 break-words text-gray-600">Compared with: {analysis.comparison.dataset_label} / {analysis.comparison.label}. {analysis.comparison_reason}</p>}
      <ul className="mt-3 list-disc space-y-2 pl-5 text-xs leading-5 text-gray-600">{[...analysis.assumptions, ...analysis.limitations].map(text => <li key={text}>{text}</li>)}</ul>
      <p className="mt-3 text-xs text-gray-500">Calculation: controlled before-and-after time series, with a trend, a comparison, and allowance for nearby periods moving together. {analysis.engine_version}</p>
    </details>}
  </section>
}
