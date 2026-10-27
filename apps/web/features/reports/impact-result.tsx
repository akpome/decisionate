import { CheckCircle2, CircleHelp } from "lucide-react"
import type { ImpactAnalysis } from "./impact-types"
import { formatReportValue } from "./types"

export function ImpactResult({ analysis, compact = false }: { analysis?: ImpactAnalysis | null; compact?: boolean }) {
  if (!analysis) return null
  const estimate = analysis.estimate
  const value = (number: number) => formatReportValue(number, analysis.outcome?.currency)
  return <section aria-label="Business change result" className="min-w-0 space-y-4 border-y border-gray-200 py-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-semibold">Did your change help?</h3><span className="text-xs font-medium text-gray-600">{estimate ? "Model-based estimate" : "Not enough reliable evidence"}</span></div>
    <p className="break-words text-sm text-gray-600">{analysis.change} / Started {analysis.change_date}</p>
    <p className="text-xl font-semibold">{analysis.headline}</p>
    <p className="break-words text-sm leading-6 text-gray-700">{analysis.summary}</p>
    {!compact && estimate && <dl className="grid min-w-0 gap-4 border-y border-gray-200 py-4 sm:grid-cols-3">
      {[["What actually happened", value(estimate.actual)], ["Expected without the change", value(estimate.expected_without_change)], [estimate.is_total ? "Estimated total difference" : "Estimated difference per period", value(estimate.effect)]].map(([label, amount]) => <div key={label} className="min-w-0"><dt className="text-xs text-gray-600">{label}</dt><dd className="mt-2 break-words text-xl font-semibold tabular-nums">{amount}</dd></div>)}
    </dl>}
    {estimate?.worthwhile_change != null && <p className="text-sm text-gray-700">Minimum worthwhile improvement: {value(estimate.worthwhile_change)}. {estimate.worthwhile_result === "likely" ? "The estimate clears your target." : estimate.worthwhile_result === "unlikely" ? "The estimate does not reach your target." : "It is not clear whether the benefit reaches your target."}</p>}
    <div><h4 className="text-sm font-semibold">What to do next</h4><ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-gray-700">{analysis.next_steps.map(text => <li key={text}>{text}</li>)}</ul></div>
    <p className="text-xs leading-5 text-gray-600">{analysis.window.start} to {analysis.window.end}{analysis.before_periods !== null && <> / {analysis.before_periods} complete periods before, {analysis.after_periods} after.</>} {estimate ? !estimate.is_total ? "Figures are averages per measured period, not totals." : "Difference covers the measured periods after the change." : "No impact amount has been estimated."}</p>
    {!compact && <details className="min-w-0 border-t border-gray-200 pt-3 text-sm"><summary className="cursor-pointer font-medium">What we checked and what could change the answer</summary>
      <ul className="mt-3 space-y-3">{analysis.checks.map(check => <li key={check.key} className="flex items-start gap-2">{check.passed ? <CheckCircle2 size={16} className="mt-1 shrink-0 text-green-700" aria-hidden="true" /> : <CircleHelp size={16} className="mt-1 shrink-0 text-amber-700" aria-hidden="true" />}<span className="min-w-0 break-words">{check.message}</span></li>)}</ul>
      {analysis.comparison && <p className="mt-3 break-words text-gray-600">Comparison: {analysis.comparison.dataset_label} / {analysis.comparison.label}. {analysis.comparison_reason}</p>}
      <ul className="mt-3 list-disc space-y-2 pl-5 text-xs leading-5 text-gray-600">{[...analysis.assumptions, ...analysis.limitations].map(text => <li key={text}>{text}</li>)}</ul>
      <p className="mt-3 text-xs text-gray-500">Calculation: controlled before-and-after time series, with a trend, a comparison, and allowance for nearby periods moving together. {analysis.engine_version}</p>
    </details>}
  </section>
}
