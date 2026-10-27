import type { ReportAnomalyAnalysis, ReportAnomalyMetric } from "./types"
import { formatReportValue } from "./types"

function evidenceValue(value: number, currency?: string | null) {
  if (Number.isFinite(value) && value !== 0 && Math.abs(value) < .01) {
    return new Intl.NumberFormat("en", { notation: "scientific", maximumFractionDigits: 4,
      ...(currency && /^[A-Z]{3}$/.test(currency) ? { style: "currency", currency } : {}),
    }).format(value)
  }
  return formatReportValue(value, currency)
}

function statusLabel(metric: ReportAnomalyMetric) {
  if (metric.status === "unavailable") return "Unavailable"
  if (metric.status === "insufficient_history") return "Insufficient history"
  const findings = metric.anomaly_count === 0 ? "No unusual changes detected" : `${metric.anomaly_count} unusual change${metric.anomaly_count === 1 ? "" : "s"}`
  return metric.status === "limited_history" ? `${findings} / Partial assessment` : findings
}

export function ReportAnomalies({ analysis, title = "Anomaly detection" }: { analysis?: ReportAnomalyAnalysis; title?: string }) {
  return <section aria-label={title} className="min-w-0 space-y-4 border-t border-gray-200 pt-5">
    <h3 className="text-lg font-semibold">{title}</h3>
    {!analysis ? <p className="text-sm text-gray-600">Anomaly detection was not recorded in this saved report.</p> : <>
      <p className="text-sm text-gray-600">Rolling history: up to {analysis.lookback_years} years / Seasonal adjustment: {analysis.seasonal_business ? "Enabled when supported" : "Off"}</p>
      {analysis.metrics.some(metric => metric.assessments) && <p className="text-sm text-gray-600">Whole week: {analysis.window.start} to {analysis.window.end}</p>}
      <ul className="min-w-0 list-none divide-y divide-gray-200" aria-label="Selected metric anomaly results">
        {analysis.metrics.map(metric => <li key={metric.metric_id} className="min-w-0 space-y-3 py-4 first:pt-0">
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
            <h4 className="min-w-0 break-words text-sm font-semibold">{metric.dataset_label} / {metric.label}</h4>
            <span className={`text-sm ${metric.status === "insufficient_history" || metric.status === "unavailable" ? "text-amber-800" : metric.anomaly_count ? "text-red-800" : "text-gray-700"}`}>{statusLabel(metric)}</span>
          </div>
          <p className="text-xs leading-5 text-gray-600">Assessed: {metric.evaluated_observations}/{metric.observations} observed periods / Missing: {metric.missing_observations} / Units: {metric.currency || metric.unit || "number"}{metric.evaluated_observations > 0 ? ` / Baseline: trend${metric.seasonalities.length ? ` + ${metric.seasonalities.join(" + ")}` : " only"}` : ""}</p>
          {metric.warnings.map(warning => <p key={warning} className="break-words text-xs leading-5 text-amber-800">{warning}</p>)}
          {(metric.assessments ?? metric.anomalies).length > 0 && <div className="max-h-80 overflow-auto" tabIndex={0} role="region" aria-label={`${metric.label} ${metric.assessments ? "whole-week assessment" : "unusual changes"}`}>
            <table className="w-full min-w-[760px] text-left text-sm [overflow-wrap:normal]">
              <thead className="sticky top-0 bg-gray-50 text-xs text-gray-600"><tr>{["Period", "Change", "Actual", "Expected", "Expected range", "Deviation"].map(label => <th key={label} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{label}</th>)}</tr></thead>
              <tbody>{(metric.assessments ?? metric.anomalies).map(point => <tr key={point.period} className="border-b border-gray-100">
                <td className="whitespace-nowrap px-3 py-2">{point.period}</td><td className="whitespace-nowrap px-3 py-2">{point.unusual === false ? "Within expected range" : point.direction === "high" ? "Above expected" : "Below expected"}</td>
                <td className="whitespace-nowrap px-3 py-2">{evidenceValue(point.value, metric.currency)}</td><td className="whitespace-nowrap px-3 py-2">{evidenceValue(point.expected, metric.currency)}</td>
                <td className="whitespace-nowrap px-3 py-2">{evidenceValue(point.lower, metric.currency)} to {evidenceValue(point.upper, metric.currency)}</td>
                <td className="whitespace-nowrap px-3 py-2">{evidenceValue(point.deviation, metric.currency)}{point.deviation_percent !== null ? ` (${point.deviation_percent.toFixed(1)}%)` : ""}</td>
              </tr>)}</tbody>
            </table>
          </div>}
          {metric.baselines.length > 0 && <details className="text-xs text-gray-600"><summary className="cursor-pointer">Baseline evidence</summary><ul className="mt-2 space-y-2 pl-4">
            {metric.baselines.map(baseline => <li key={baseline.start} className="break-words leading-5">{baseline.start} to {baseline.end}: history {baseline.history_start} to {baseline.history_end}; {baseline.observations} observations; {baseline.calibration_observations} past-only validation observations; {baseline.method.replaceAll("_", " ")}; spread {evidenceValue(baseline.spread, metric.currency)}.</li>)}
          </ul></details>}
        </li>)}
      </ul>
      <details className="text-xs text-gray-600"><summary className="cursor-pointer">Detection limitations</summary><ul className="mt-2 list-disc space-y-2 pl-4">{analysis.limitations.map(text => <li key={text} className="break-words leading-5">{text}</li>)}</ul></details>
    </>}
  </section>
}
