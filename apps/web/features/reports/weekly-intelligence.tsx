"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { dimensionFilterLabel } from "@/features/datasets/components/dimension-filter"
import { formatReportValue, type BusinessReport } from "./types"
import type { IntelligenceFinding } from "./weekly-intelligence-types"
import { ReportAnomalies } from "./report-anomalies"

const section = "min-w-0 space-y-4 border-b border-gray-200 pb-6"
const heading = "text-lg font-semibold"
const link = "inline-flex min-h-10 items-center gap-2 text-sm font-medium text-blue-700 underline"

function Notes({ values }: { values: string[] }) {
  return values.length ? <ul className="list-disc space-y-2 pl-5 text-sm text-gray-600">{values.map((value, index) => <li key={index} className="break-words">{value.replaceAll("_", " ")}</li>)}</ul> : null
}

function Finding({ item, report }: { item: IntelligenceFinding; report: BusinessReport }) {
  const metric = report.metrics.find(value => value.id === item.metric_ids[0])
  const value = (number: number | null) => formatReportValue(number, metric?.currency)
  return <article id={item.id} className="min-w-0 space-y-2 border-l-2 border-blue-500 pl-4">
    <h4 className="break-words font-medium">{item.title}</h4>
    <p className="break-words text-sm leading-6">{item.observation}</p>
    <p className="text-xs text-gray-600">{item.continuity}</p>
    <details className="space-y-3 text-sm"><summary className="cursor-pointer font-medium">Supporting evidence</summary>
      <p className="break-words">{metric?.dataset_label} / {metric?.label} / {metric?.aggregation}</p>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div><dt className="text-xs text-gray-500">Report week</dt><dd>{value(item.evidence.current)}</dd><dd className="text-xs text-gray-500">{item.window.start} to {item.window.end}</dd></div>
        <div><dt className="text-xs text-gray-500">Previous week</dt><dd>{value(item.evidence.previous)}</dd><dd className="text-xs text-gray-500">{item.previous_window.start} to {item.previous_window.end}</dd></div>
        <div><dt className="text-xs text-gray-500">Change</dt><dd>{value(item.evidence.change)}</dd><dd className="text-xs text-gray-500">{item.evidence.coverage.join(" / ")} daily periods covered</dd></div>
      </dl>
      {item.evidence.unusual_periods.map(point => <p key={point.period}>{point.period}: {value(point.value)}; expected range {value(point.lower)} to {value(point.upper)}.</p>)}
      <p>{item.relevance}</p><p className="text-xs text-gray-500">Priority basis: {item.rank_basis}</p>
      <Notes values={item.limitations} />
    </details>
    {item.related_decision_id && <Link href={`/dashboard/decisions/${item.related_decision_id}`} className={link}>View existing decision<ArrowRight size={16} /></Link>}
  </article>
}

export function WeeklyIntelligenceReport({ report, snapshot, onReview, busy }: {
  report: BusinessReport; snapshot: ReactNode; onReview?: (findingId: string) => void; busy: boolean
}) {
  const intelligence = report.intelligence!
  const label = (id: string) => { const metric = report.metrics.find(item => item.id === id); return metric ? `${metric.dataset_label} / ${metric.label}` : id }
  const count = intelligence.default_finding_count
  return <div className="min-w-0 space-y-6">
    <section className={section} aria-label="Weekly intelligence summary"><h3 className={heading}>This week at a glance</h3>
      <p className="break-words text-sm leading-7">{intelligence.summary}</p>
      <p className="text-xs text-gray-500">{intelligence.narrative_source === "rules" ? "Evidence-based summary" : "AI-selected summary from verified evidence"} / {intelligence.reporting_timezone}</p>
    </section>
    <section className={section} aria-label="Business performance snapshot"><h3 className={heading}>Business performance</h3>
      {(report.definition.dimension_filters || []).map(selection => <p key={selection.dataset_id} className="break-words text-sm text-gray-600"><span className="font-medium">{report.metrics.find(metric => metric.dataset_id === selection.dataset_id)?.dataset_label || `Dataset ${selection.dataset_id}`}</span> / {dimensionFilterLabel(selection)}</p>)}
      {snapshot}</section>
    <section className={section} aria-label="Priority intelligence findings"><h3 className={heading}>What deserves attention</h3>
      {intelligence.findings.length === 0 && <p className="text-sm text-gray-600">No supported priority change was identified. Review the coverage below.</p>}
      {intelligence.findings.slice(0, count).map(item => <Finding key={item.id} item={item} report={report} />)}
      {intelligence.findings.length > count && <details className="space-y-4"><summary className="cursor-pointer text-sm font-medium">More findings ({intelligence.findings.length - count})</summary>{intelligence.findings.slice(count).map(item => <Finding key={item.id} item={item} report={report} />)}</details>}
      <details><summary className="cursor-pointer text-xs text-gray-600">How findings are prioritized</summary><p className="mt-2 text-xs leading-5 text-gray-600">{intelligence.prioritization}</p></details>
      {report.definition.include_anomalies !== false && <details className="min-w-0 space-y-4"><summary className="cursor-pointer text-sm font-medium">Daily and whole-week anomaly checks</summary>
        <ReportAnomalies analysis={report.weekly_anomaly_analysis} title="Whole-week anomaly detection" />
        <ReportAnomalies analysis={report.anomaly_analysis} title="Daily anomaly detection" />
      </details>}
    </section>
    <section className={section} aria-label="Cross-dataset investigations"><h3 className={heading}>Connections worth investigating</h3>
      {!intelligence.investigations.length && <p className="text-sm text-gray-600">No eligible relationship was investigated for these changes. No cause has been identified.</p>}
      {intelligence.investigations.map(item => <article key={item.relationship_id} className="min-w-0 space-y-2">
        <h4 className="break-words text-sm font-medium">{item.metric_ids.map(label).join(" and ")}</h4>
        <p className="text-xs text-gray-600">{item.status === "pattern_to_investigate" ? "Historical pattern, not proof of a cause" : "Relationship not established"}</p>
        <p className="break-words text-sm leading-6">{item.summary}</p>
        <details className="space-y-2 text-sm"><summary className="cursor-pointer font-medium">Relationship evidence</summary>
          <p>Correlation coefficient: {item.coefficient === null ? "Unavailable" : item.coefficient.toFixed(3)} / {item.status === "pattern_to_investigate" ? `Observed delay: ${item.lag} ${item.lag_unit}` : "No reliable delay established"}</p>
          <p>{item.observations} matched periods / {item.history_window.start} to {item.history_window.end}</p><Notes values={item.limitations} />
        </details>
      </article>)}
    </section>
    <section className={section} aria-label="Recommended actions"><h3 className={heading}>Recommended next steps</h3>
      {!intelligence.recommendations.length && <p className="text-sm text-gray-600">No supported action is included in this report.</p>}
      {intelligence.recommendations.map(item => <article key={item.id} className="min-w-0 space-y-2">
        <a href={`#${item.finding_id}`} className="text-sm font-medium text-blue-700 underline">{intelligence.findings.find(finding => finding.id === item.finding_id)?.title}</a>
        <p className="break-words text-sm leading-6">{item.action}</p>
        <p className="break-words text-xs text-gray-600">{item.priority} / Success metric: {label(item.success_metric_id)}</p>
        <details className="space-y-2"><summary className="cursor-pointer text-sm">Expected result and limitations</summary><p className="text-sm">{item.expected_direction}</p><Notes values={item.limitations} /></details>
        {item.related_decision_id ? <Link className={link} href={`/dashboard/decisions/${item.related_decision_id}`}>View existing decision<ArrowRight size={16} /></Link>
          : onReview && report.status === "ready" && <button type="button" className={`${link} disabled:opacity-50`} disabled={busy} onClick={() => onReview(item.finding_id)}>Review in Decisions<ArrowRight size={16} /></button>}
      </article>)}
    </section>
    <section className={section} aria-label="Decisions and outcomes"><h3 className={heading}>Decisions and outcomes</h3>
      <p className="text-xs text-gray-500">Recorded when this report was generated: {intelligence.as_of.slice(0, 19).replace("T", " ")} UTC</p>
      {!intelligence.decisions.length && <p className="text-sm text-gray-600">No relevant decision progress was recorded.</p>}
      {intelligence.decisions.map(item => <article key={item.id} className="min-w-0 space-y-2">
        <Link href={`/dashboard/decisions/${item.id}`} className={link}>{item.title}<ArrowRight size={16} /></Link><p className="text-sm">{item.assessment} / {item.status.replaceAll("_", " ")}</p>
        <p className="break-words text-sm">Success metric: {item.success_metric}</p>
        <details className="space-y-2 text-sm"><summary className="cursor-pointer">Progress evidence</summary>
          <p className="break-words">Owner: {item.owner_name || "Assigned owner"}</p><p>Baseline: {formatReportValue(item.baseline, item.currency)}</p><p className="break-words">Target: {item.target || "Not recorded"}</p>
          <p>Recorded outcome value: {formatReportValue(item.recorded_value, item.currency)}{item.recorded_at ? ` / ${item.recorded_at.slice(0, 10)}` : ""}</p>
          <p className="break-words">{item.recorded_outcome || "No outcome assessment recorded."}</p>
          {item.monitoring_period && <p>Observed this week: {formatReportValue(item.observed_value, item.currency)} / {item.monitoring_period.start} to {item.monitoring_period.end}</p>}
          <p>Review due: {item.review_date?.slice(0, 10) || "Not scheduled"}</p><p className="text-gray-600">{item.limitation}</p>
        </details>
      </article>)}
    </section>
    <section className={section} aria-label="Data quality and coverage"><h3 className={heading}>Data quality and coverage</h3>
      <p className="text-sm">{report.status === "ready" ? "Cross-dataset coverage available. Individual relationships may still be unsupported." : "Limited coverage. This is not a completed cross-dataset assessment."}</p>
      <Notes values={intelligence.quality} />
      <details className="space-y-3"><summary className="cursor-pointer text-sm font-medium">Source records and analytical limits</summary>
        {intelligence.sources.map(source => <div key={`${source.dataset_id}:${source.date_column}`} className="space-y-1 text-sm"><p className="break-words font-medium">{source.dataset_label}</p><p>Date column: {source.date_column} / Latest record: {source.latest_observation || "Unavailable"}</p><p>Last successful connector sync: {source.last_synced_at || "Not verified"}</p></div>)}
        <p className="text-sm text-gray-600">{intelligence.forecast_status}</p><Notes values={report.limitations} />
      </details>
    </section>
  </div>
}
