import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowUpRight, ChartNoAxesCombined } from "lucide-react"
import type { BusinessReport, ReportDefinition } from "./types"

export function WeeklyAssessmentSetup({ definition, issue, onSwitch, preview }: {
  definition: ReportDefinition; issue: string; onSwitch?: () => void; preview: ReactNode
}) {
  const study = definition.impact
  if (!study) return null
  return <section aria-label="Existing decision update" className="min-w-0 space-y-4 border-y border-gray-200 py-5">
    <h2 className="text-base font-semibold">Existing decision update</h2>
    <p className="break-words text-sm text-gray-700">{study.change || "No action recorded."}</p>
    <p className="text-sm text-gray-600">The existing assessment configuration is retained. Decision assessment is managed in Business Analysis.</p>
    <Link href={study.decision_id ? `/dashboard/reports?decision=${study.decision_id}` : "/dashboard/reports"} className="inline-flex min-h-10 items-center gap-2 text-sm text-blue-700 underline"><ArrowUpRight size={16} />Manage assessment in Business Analysis</Link>
    {issue && <p role="status" className="text-sm text-amber-800">{issue}</p>}
    <div className="flex flex-wrap items-center gap-3">
      {onSwitch && <button type="button" onClick={onSwitch} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium"><ChartNoAxesCombined size={16} />Set up metric monitoring</button>}
      <div className="w-full sm:w-auto">{preview}</div>
    </div>
  </section>
}

export function WeeklyDecisionUpdate({ report }: { report: BusinessReport }) {
  const analysis = report.impact_analysis
  if (!analysis) return null
  const decisionId = report.definition.impact?.decision_id
  return <section aria-label="Decision update" className="min-w-0 space-y-3 border-t border-gray-200 pt-5">
    <h3 className="text-lg font-semibold">Decision update</h3>
    <p className="break-words text-sm font-medium">{analysis.headline}</p>
    <p className="break-words text-sm leading-6 text-gray-700">{analysis.summary}</p>
    <p className="text-xs text-gray-600">Assessment period: {analysis.window.start} to {analysis.window.end}. {analysis.estimate ? "Estimated impact, not proof of cause and effect." : "No impact amount has been estimated."}</p>
    {decisionId && !report.review_decision_missing && <Link href={`/dashboard/decisions/${decisionId}#business-impact-review`} className="inline-flex min-h-10 items-center gap-2 text-sm text-blue-700 underline"><ArrowUpRight size={16} />View decision</Link>}
    <details className="min-w-0 text-sm"><summary className="cursor-pointer text-gray-600">Assessment evidence</summary><div className="mt-3 space-y-2 text-gray-600">
      <p>{analysis.change} / Implemented {analysis.change_date}</p>
      <ul className="list-disc space-y-2 pl-5">{analysis.checks.map(check => <li key={check.key}>{check.message}</li>)}</ul>
      <ul className="list-disc space-y-2 pl-5">{analysis.limitations.map(text => <li key={text}>{text}</li>)}</ul>
    </div></details>
  </section>
}
