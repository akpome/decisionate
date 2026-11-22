import Link from "next/link"
import type { ReactNode } from "react"
import { ArrowUpRight, LoaderCircle, Plus } from "lucide-react"
import { getDecisionDisplayTitle, isLegacyEvidencePlaceholder } from "@/features/decisions/lib/decision-title"
import { decisionEvidenceHref } from "@/features/decisions/lib/report-metric-scope"
import type { BusinessReport, ReportDecision, ReportFinding } from "./types"
import { relationshipDirectionOptions } from "@/features/relationships/direction-options"
import { unorderedReportPairKey, type PairDirection, type ReportMetricPair } from "./pair-directions"

const decisionAction = "inline-flex min-h-10 max-w-full items-center justify-center gap-2 rounded-md border border-blue-700 bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 print:hidden"

export function ReportRelationshipFindings({ report, busy = false, updatingPair, onDirectionChange }: { report: BusinessReport; busy?: boolean; updatingPair?: string | null; onDirectionChange?: (pair: ReportMetricPair, direction: PairDirection) => void }) {
  if (report.definition?.impact || report.impact_analysis || report.definition?.include_relationships === false || report.definition?.scope === "single") return null
  const included = new Set(report.included_findings)
  const findings = report.findings.filter(finding => included.has(finding.id))
  return <section className="space-y-3 border-t border-gray-200 pt-5" aria-label="Relationship findings">
    <h3 className="text-lg font-semibold">Relationship findings</h3>
    <p className="text-sm leading-6 text-gray-600">Lead means the metric that changes first. Lag is the time between its change and the other metric&apos;s change. For example, spending may change before sales do; this does not prove the spending caused the sales.</p>
    <p className="text-xs leading-5 text-gray-600">Correlation runs from -1 to +1. Near +1: rise and fall together. Near -1: move in opposite directions. Near 0: no clear pattern in this test. This is not a percentage or revenue earned per dollar.</p>
    {findings.length === 0 ? <p className="text-sm text-gray-500">No relationship findings included in this report.</p>
      : <ul aria-label="Relationship results" className="list-none">{findings.map(finding => {
        const pair = {
          metric_a: { dataset_id: finding.metric_a.dataset_id, metric_key: finding.metric_a.metric_key },
          metric_b: { dataset_id: finding.metric_b.dataset_id, metric_key: finding.metric_b.metric_key },
        }
        const stored = report.definition?.pair_directions?.find(item => unorderedReportPairKey(item) === unorderedReportPairKey(pair))
        const explicit = stored?.direction === "a_leads_b" || stored?.direction === "b_leads_a"
        const leader = explicit ? stored.direction === "a_leads_b" ? stored.metric_a : stored.metric_b : null
        const value = leader ? leader.dataset_id === finding.metric_a.dataset_id && leader.metric_key === finding.metric_a.metric_key ? "a_leads_b" : "b_leads_a" : "auto"
        const updating = busy && updatingPair === unorderedReportPairKey(pair)
        return <li key={finding.id} className="min-w-0 border-b border-gray-100 py-3"><Finding finding={finding} grain={report.analysis_grain || report.grain || report.definition?.grain} />
          {onDirectionChange && <label className="mt-3 block max-w-2xl text-xs text-gray-600 print:hidden"><span className="flex min-h-5 flex-wrap items-center justify-between gap-x-3"><span>Relationship direction</span>{updating && <span role="status" className="inline-flex items-center gap-1.5 text-blue-700"><LoaderCircle size={14} aria-hidden="true" className="shrink-0 animate-spin motion-reduce:animate-none" />Processing...</span>}</span><select aria-label={`Relationship direction: ${finding.metric_a.dataset_label} / ${finding.metric_a.label} and ${finding.metric_b.dataset_label} / ${finding.metric_b.label}`} value={value} disabled={busy} aria-busy={updating}
            onChange={event => { if (!busy) onDirectionChange(pair, event.target.value as PairDirection) }} className="mt-1 h-10 w-full min-w-0 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-950 disabled:cursor-wait disabled:bg-gray-50">
            {relationshipDirectionOptions(`${finding.metric_a.dataset_label} / ${finding.metric_a.label}`, `${finding.metric_b.dataset_label} / ${finding.metric_b.label}`, text => text).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select></label>}
        </li>
      })}</ul>}
  </section>
}

export function ReportDecisions({ report, onOpenDraft, busy = false, composer, businessAnalysis = false }: {
  report: BusinessReport; onOpenDraft?: (decisionId?: number) => Promise<void>; busy?: boolean; composer?: ReactNode; businessAnalysis?: boolean
}) {
  const reviewedDecision = report.definition?.impact?.decision_id
  const followUps = reviewedDecision && report.report_id ? report.decisions.filter(item => item.id !== reviewedDecision && item.report_id === report.report_id && !(item.is_draft ?? isLegacyEvidencePlaceholder(item))) : []
  if (reviewedDecision) return <section className="space-y-3 border-t border-gray-200 pt-5" aria-label="Decisions and outcomes">
    <h3 className="text-lg font-semibold">Decision under review</h3>
    {report.review_decision_missing ? <p className="text-sm text-gray-600">The decision is no longer available. This report remains historical evidence.</p> : <>
      <Link className="break-words font-medium text-blue-700 underline" href={`/decisions/${reviewedDecision}#business-impact-review`}>{report.review_decision ? getDecisionDisplayTitle(report.review_decision) : `Decision #${reviewedDecision}`}</Link>
      <p className="text-sm text-gray-600">{report.decision_review_id ? "Assessment attached to this decision." : "Assessment not yet saved to this decision."}</p>
      {businessAnalysis && followUps.map(item => <p key={item.id} className="text-sm">Follow-up: <Link className="text-blue-700 underline" href={`/decisions/${item.id}`}>{getDecisionDisplayTitle(item)}</Link></p>)}
      {businessAnalysis && !followUps.length && report.impact_analysis?.status === "estimated" && report.status === "ready" && onOpenDraft &&
        (composer || <button type="button" className={decisionAction} disabled={busy} onClick={() => void onOpenDraft()}><Plus size={16}/>{report.decision_review_id ? "Create follow-up decision" : "Save assessment and plan a follow-up"}</button>)}
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
  const coverageIssue = report.status === "ready" ? "" : `Decision evidence unavailable: ${report.definition?.scope === "single" ? "the selected dataset has no usable values" : "fewer than two datasets have usable values"} ${report.window ? `for ${report.window.start} to ${report.window.end}` : "in this report's dates"}.`
  const blockedReason = draft?.report_id ? "" : coverageIssue
  return <section className="space-y-3 border-t border-gray-200 pt-5" aria-label="Decisions and outcomes">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-lg font-semibold">Decisions and outcomes</h3>
      <Link className="text-sm text-blue-700 underline print:hidden" href="/decisions">Manage decisions</Link>
    </div>
    {composer || (active.length > 0 ? active.map(decision => <DecisionRow key={decision.id} decision={decision} report={report} />)
      : draft ? <div className="min-w-0 border-b border-gray-100 pb-3" aria-label="Existing decision draft">
        <p className="mb-1 text-xs font-medium text-amber-800">Earlier draft for these datasets</p>
        {onOpenDraft ? <button type="button" disabled={busy || Boolean(blockedReason)} aria-describedby={blockedReason ? "report-decision-unavailable" : undefined} onClick={() => void onOpenDraft(draft.id)} className={decisionAction}><ArrowUpRight size={16} aria-hidden="true" />Continue decision</button>
          : <Link className="break-words font-medium text-blue-700 underline" href={decisionEvidenceHref(draft.id, report.definition.metrics)}>Continue decision</Link>}
        <p className="mt-1 text-sm text-gray-600">Action not recorded.</p>
        {businessAnalysis && onOpenDraft && !coverageIssue && <button type="button" className="mt-2 text-sm font-medium text-blue-700 underline print:hidden" disabled={busy} onClick={() => void onOpenDraft()}>Create a new decision from this report</button>}
        {onOpenDraft && blockedReason && <p id="report-decision-unavailable" role="status" className="mt-2 text-sm text-amber-800">{blockedReason}</p>}
      </div>
        : onOpenDraft ? <div className="min-w-0 border-b border-gray-100 pb-3">
          <button type="button" disabled={busy || Boolean(blockedReason)} aria-describedby={blockedReason ? "report-decision-unavailable" : undefined} onClick={() => void onOpenDraft()} className={decisionAction}><Plus size={16} aria-hidden="true" />Create decision</button>
          {blockedReason && <p id="report-decision-unavailable" role="status" className="mt-2 text-sm text-amber-800">{blockedReason}</p>}
        </div> : <p className="text-sm text-gray-500">No active decisions linked to this report.</p>)}
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

function formatFindingLag(finding: ReportFinding, grain?: string) {
  if (!Number.isInteger(finding.lag) || finding.lag < 0) return "Not established"
  if (finding.lag === 0) return "0 (same period)"
  const sourceGrain = {
    "calendar daily periods": "daily", "calendar weekly periods": "weekly",
    "calendar monthly periods": "monthly", "calendar quarterly periods": "quarterly",
  }[finding.lag_unit] || grain || ""
  const unit = { daily: "day", weekly: "week", monthly: "month", quarterly: "quarter" }[sourceGrain] || "grouped period"
  return `${finding.lag} ${unit}${finding.lag === 1 ? "" : "s"}`
}

function Finding({ finding, grain }: { finding: ReportFinding; grain?: string }) {
  const hasCoefficient = typeof finding.coefficient === "number" && Number.isFinite(finding.coefficient)
  const available = finding.eligible && hasCoefficient
  const hasLag = available && Number.isInteger(finding.lag) && finding.lag >= 0
  const leader = finding.lead_metric === finding.metric_a.id ? finding.metric_a : finding.lead_metric === finding.metric_b.id ? finding.metric_b : null
  const follower = leader === finding.metric_a ? finding.metric_b : finding.metric_a
  const pattern = !available ? "We do not have enough matching history or variation to draw a useful conclusion yet."
    : Math.abs(finding.coefficient!) < .3 ? "These results did not show a clear pattern of moving together."
      : finding.coefficient! >= 0 ? "These results tended to rise and fall together." : "When one result rose, the other tended to fall."
  return <><span className="block break-words text-sm font-semibold">{finding.metric_a.dataset_label} / {finding.metric_a.label} <span className="font-normal text-gray-500">and</span> {finding.metric_b.dataset_label} / {finding.metric_b.label}</span>
    <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]" aria-label="Correlation statistics">
      <div className="min-w-0"><dt className="text-xs text-gray-500">Correlation coefficient<span className="mt-1 block text-gray-600">How closely the metrics move together</span></dt><dd className="mt-1 font-semibold tabular-nums">{hasCoefficient ? finding.coefficient!.toFixed(2) : "Not calculated"}</dd>
      </div>
      <div className="min-w-0"><dt className="text-xs text-gray-500">Lag (observed)<span className="mt-1 block text-gray-600">Time between changes</span></dt><dd className="mt-1 font-semibold">{hasLag ? formatFindingLag(finding, grain) : "Not established"}</dd>
        {hasLag && finding.lag > 0 && leader && <p className="mt-1 break-words text-xs text-gray-600">{leader.dataset_label} / {leader.label} precedes {follower.dataset_label} / {follower.label}.</p>}
        <dd className="mt-1 text-xs leading-5 text-gray-600">Lag is not a promise of when a future result will appear. Zero means both were compared in the same period.</dd>
      </div>
    </dl>
    {finding.direction_suggestion && <div className="mt-3 space-y-1 text-sm">
      <p className="break-words font-medium">Relationship direction: {finding.direction_suggestion.direction && leader ? `${leader.dataset_label} / ${leader.label} leads ${follower.dataset_label} / ${follower.label}` : "Not established"}</p>
      <p className="text-xs leading-5 text-gray-600">{finding.direction_suggestion.message}</p>
    </div>}
    <p className="mt-2 text-sm leading-6 text-gray-700">{finding.business_summary || <>{pattern} {available && "That can be worth investigating, but does not tell us whether changing one caused the other to change."}</>}</p>
    {available && finding.timing_validation && <p className="mt-1 text-xs leading-5 text-gray-600">{finding.timing_validation.status === "supported" ? "Timing guide available for a later impact assessment. " : "Not yet a dependable timing guide. "}{finding.timing_validation.message}</p>}
    <details className="mt-2 text-xs text-gray-500"><summary className="cursor-pointer">How we checked this relationship</summary><p className="mt-2">{finding.reliability.replaceAll("_", " ")} / {finding.observations} observations</p><p className="mt-2 leading-5">{finding.interpretation}</p>{finding.warnings.length > 0 && <p className="mt-1 break-words text-amber-800">{finding.warnings.map(value => value.replaceAll("_", " ")).join("; ")}</p>}</details></>
}
