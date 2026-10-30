import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { getDecisionDisplayTitle, isLegacyEvidencePlaceholder } from "@/features/decisions/lib/decision-title"
import { decisionEvidenceHref } from "@/features/decisions/lib/report-metric-scope"
import type { BusinessReport, ReportDecision, ReportFinding } from "./types"

export function ReportRelationshipFindings({ report }: { report: BusinessReport }) {
  if (report.definition?.impact || report.impact_analysis) return null
  const included = new Set(report.included_findings)
  const findings = report.findings.filter(finding => included.has(finding.id))
  return <section className="space-y-3 border-t border-gray-200 pt-5" aria-label="Relationship findings">
    <h3 className="text-lg font-semibold">Relationship findings</h3>
    {findings.length === 0 ? <p className="text-sm text-gray-500">No relationship findings included in this report.</p>
      : <ul aria-label="Relationship results" className="list-none">{findings.map(finding => <li key={finding.id} className="min-w-0 border-b border-gray-100 py-3"><Finding finding={finding} /></li>)}</ul>}
  </section>
}

export function ReportDecisions({ report, onOpenDraft, busy = false }: {
  report: BusinessReport; onOpenDraft?: (decisionId?: number) => Promise<void>; busy?: boolean
}) {
  const reviewedDecision = report.definition?.impact?.decision_id
  if (reviewedDecision) return <section className="space-y-3 border-t border-gray-200 pt-5" aria-label="Decisions and outcomes">
    <h3 className="text-lg font-semibold">Decision under review</h3>
    {report.review_decision_missing ? <p className="text-sm text-gray-600">The decision is no longer available. This report remains historical evidence.</p> : <>
      <Link className="break-words font-medium text-blue-700 underline" href={`/dashboard/decisions/${reviewedDecision}#business-impact-review`}>{report.review_decision ? getDecisionDisplayTitle(report.review_decision) : `Decision #${reviewedDecision}`}</Link>
      <p className="text-sm text-gray-600">{report.decision_review_id ? "Assessment attached to this decision." : "Assessment not yet saved to this decision."}</p>
    </>}
  </section>
  const seen = new Set<number>()
  const reportId = report.report_id || report.decision_report_id
  const decisions = reportId ? report.decisions.filter(decision => {
    if (decision.report_id !== reportId || seen.has(decision.id) || (decision.is_draft ?? isLegacyEvidencePlaceholder(decision))) return false
    seen.add(decision.id)
    return true
  }) : []
  const active = decisions.filter(decision => decision.status !== "archived")
  const archived = decisions.filter(decision => decision.status === "archived")
  const datasetIds = new Set(report.definition?.metrics.map(metric => metric.dataset_id) || [])
  const draft = active.length === 0 ? (report.decision_drafts || []).find(decision =>
    decision.status === "planned" && (decision.is_draft ?? isLegacyEvidencePlaceholder(decision)) &&
    (!decision.report_id || decision.report_id === reportId) && datasetIds.size >= 2 &&
    new Set(decision.evidence_dataset_ids).size === datasetIds.size &&
    decision.evidence_dataset_ids?.every(identity => datasetIds.has(identity))
  ) : undefined
  return <section className="space-y-3 border-t border-gray-200 pt-5" aria-label="Decisions and outcomes">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-lg font-semibold">Decisions and outcomes</h3>
      <Link className="text-sm text-blue-700 underline print:hidden" href="/dashboard/decisions">Manage decisions</Link>
    </div>
    {active.length > 0 ? active.map(decision => <DecisionRow key={decision.id} decision={decision} report={report} />)
      : draft ? <div className="min-w-0 border-b border-gray-100 pb-3" aria-label="Existing decision draft">
        <p className="mb-1 text-xs font-medium text-amber-800">Earlier draft for these datasets</p>
        {onOpenDraft ? <button type="button" disabled={busy} onClick={() => void onOpenDraft(draft.id)} className="inline-flex min-h-10 items-center gap-1 font-medium text-blue-700 underline disabled:opacity-50"><ArrowUpRight size={16} aria-hidden="true" />Decision draft</button>
          : <Link className="break-words font-medium text-blue-700 underline" href={decisionEvidenceHref(draft.id, report.definition.metrics)}>Decision draft</Link>}
        <p className="mt-1 text-sm text-gray-600">Action not recorded.</p>
      </div>
        : onOpenDraft ? <div className="min-w-0 border-b border-gray-100 pb-3" aria-label="Decision draft">
          <button type="button" disabled={busy || report.status !== "ready"} onClick={() => void onOpenDraft()} title={report.status !== "ready" ? "Resolve report coverage before opening a decision draft" : "Open decision draft"} className="inline-flex min-h-10 items-center gap-1 font-medium text-blue-700 underline disabled:opacity-50"><ArrowUpRight size={16} aria-hidden="true" />Decision draft</button>
          <p className="mt-1 text-sm text-gray-600">Action not recorded.</p>
        </div> : <p className="text-sm text-gray-500">No active decisions linked to this report.</p>}
    {archived.length > 0 && <details className="min-w-0 border-t border-gray-100 pt-3 text-sm">
      <summary className="cursor-pointer text-gray-600">Archived decisions ({archived.length})</summary>
      <div className="mt-3 space-y-3">{archived.map(decision => <DecisionRow key={decision.id} decision={decision} report={report} />)}</div>
    </details>}
  </section>
}

function DecisionRow({ decision, report }: { decision: ReportDecision; report: BusinessReport }) {
  return <div className="min-w-0 border-b border-gray-100 pb-3">
    <Link className="break-words font-medium text-blue-700 underline" href={decisionEvidenceHref(decision.id, report.definition?.metrics || [])}>{getDecisionDisplayTitle(decision)}</Link>
    <p className="mt-1 text-xs text-gray-500">{decision.status} / Owner: {decision.owner_user_id}{decision.review_date ? ` / Review: ${decision.review_date.slice(0, 10)}` : ""}</p>
    <p className="mt-2 text-sm">Expected: {decision.expected_outcome || "Not recorded"}</p>
    <p className="mt-1 text-sm">Actual: {decision.actual_outcome || "Not yet recorded"}</p>
    {typeof decision.change_percent === "number" && <p className="mt-1 text-sm">Measured change: {decision.change_percent.toFixed(1)}%</p>}
  </div>
}

function Finding({ finding }: { finding: ReportFinding }) {
  const available = finding.eligible && finding.coefficient !== null
  const pattern = !available ? "We do not have enough matching history or variation to draw a useful conclusion yet."
    : Math.abs(finding.coefficient!) < .3 ? "These results did not show a clear pattern of moving together."
      : finding.coefficient! >= 0 ? "These results tended to rise and fall together." : "When one result rose, the other tended to fall."
  return <><span className="block break-words text-sm font-semibold">{finding.metric_a.dataset_label} / {finding.metric_a.label} <span className="font-normal text-gray-500">and</span> {finding.metric_b.dataset_label} / {finding.metric_b.label}</span>
    <p className="mt-2 text-sm leading-6 text-gray-700">{finding.business_summary || <>{pattern} {available && "That can be worth investigating, but does not tell us whether changing one caused the other to change."}</>}</p>
    {available && finding.lag > 0 && <p className="mt-1 text-xs text-gray-600">The strongest pattern was {finding.lag} grouped periods apart.</p>}
    {available && finding.timing_validation && <p className="mt-1 text-xs leading-5 text-gray-600">{finding.timing_validation.status === "supported" ? "Timing guide available for a later impact assessment. " : "Not yet a dependable timing guide. "}{finding.timing_validation.message}</p>}
    <details className="mt-2 text-xs text-gray-500"><summary className="cursor-pointer">How we checked this relationship</summary><p className="mt-2">{finding.reliability.replaceAll("_", " ")} / {finding.observations} observations / Lag {finding.lag} {finding.lag_unit}</p><p className="mt-2 leading-5">{finding.interpretation}</p>{finding.warnings.length > 0 && <p className="mt-1 break-words text-amber-800">{finding.warnings.map(value => value.replaceAll("_", " ")).join("; ")}</p>}</details></>
}
