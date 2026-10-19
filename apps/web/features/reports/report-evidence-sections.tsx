import Link from "next/link"
import { getDecisionDisplayTitle, isLegacyEvidencePlaceholder } from "@/features/decisions/lib/decision-title"
import type { BusinessReport, ReportFinding } from "./types"

export function ReportRelationshipFindings({ report }: { report: BusinessReport }) {
  const included = new Set(report.included_findings)
  const findings = report.findings.filter(finding => included.has(finding.id))
  return <section className="space-y-3 border-t border-gray-200 pt-5" aria-label="Relationship findings">
    <h3 className="text-lg font-semibold">Relationship findings</h3>
    {findings.length === 0 ? <p className="text-sm text-gray-500">No relationship findings included in this report.</p>
      : findings.map(finding => <div key={finding.id} className="min-w-0 border-b border-gray-100 py-3"><Finding finding={finding} /></div>)}
  </section>
}

export function ReportDecisions({ report }: { report: BusinessReport }) {
  const seen = new Set<number>()
  const reportId = report.report_id || report.decision_report_id
  const decisions = reportId ? report.decisions.filter(decision => {
    if (decision.report_id !== reportId || seen.has(decision.id) || isLegacyEvidencePlaceholder(decision)) return false
    seen.add(decision.id)
    return true
  }) : []
  return <section className="space-y-3 border-t border-gray-200 pt-5" aria-label="Decisions and outcomes">
    <h3 className="text-lg font-semibold">Decisions and outcomes</h3>
    {decisions.length === 0 ? <p className="text-sm text-gray-500">No decisions linked to this report.</p>
      : decisions.map(decision => <div key={decision.id} className="border-b border-gray-100 pb-3">
        <Link className="break-words font-medium text-blue-700 underline" href={`/dashboard/decisions/${decision.id}`}>{getDecisionDisplayTitle(decision)}</Link>
        <p className="mt-1 text-xs text-gray-500">{decision.status} / Owner: {decision.owner_user_id}{decision.review_date ? ` / Review: ${decision.review_date.slice(0, 10)}` : ""}</p>
        <p className="mt-2 text-sm">Expected: {decision.expected_outcome || "Not recorded"}</p>
        <p className="mt-1 text-sm">Actual: {decision.actual_outcome || "Not yet recorded"}</p>
        {decision.change_percent !== null && <p className="mt-1 text-sm">Measured change: {decision.change_percent.toFixed(1)}%</p>}
      </div>)}
  </section>
}

function Finding({ finding }: { finding: ReportFinding }) {
  return <><span className="block break-words text-sm font-semibold">{finding.metric_a.dataset_label} / {finding.metric_a.label} <span className="font-normal text-gray-500">and</span> {finding.metric_b.dataset_label} / {finding.metric_b.label}</span><span className="mt-1 block text-xs text-gray-500">{finding.reliability.replaceAll("_", " ")} / {finding.observations} observations / Lag {finding.lag} {finding.lag_unit}</span><span className="mt-2 block text-sm leading-6 text-gray-700">{finding.interpretation}</span>{finding.warnings.length > 0 && <span className="mt-1 block break-words text-xs text-amber-800">{finding.warnings.map(value => value.replaceAll("_", " ")).join("; ")}</span>}</>
}
