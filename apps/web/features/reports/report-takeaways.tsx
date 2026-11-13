import { getAIAnalysisProvenance } from "@/features/ai/lib/analysis-copy"
import type { BusinessReport } from "./types"
import { reportNextSteps } from "./report-workflow"

export function ReportTakeaways({ report }: { report: BusinessReport }) {
  const analysis = report.ai_analysis
  const actions = reportNextSteps(report)
  const summary = analysis?.summary || report.observations.slice(0, 2).join(" ") || "Review the available results and evidence before deciding on a change."
  return <section aria-label="Report takeaways" className="min-w-0 space-y-4 border-b border-gray-200 pb-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-lg font-semibold">What matters</h3>{analysis && <span className="text-xs text-gray-600">{analysis.confidence} confidence</span>}</div>
    <p className="break-words text-sm leading-6 text-gray-800">{summary}</p>
    <div className="space-y-2"><h4 className="text-sm font-semibold">Next steps</h4>
      {actions.length ? <ul className="list-disc space-y-2 pl-5 text-sm leading-6">{actions.slice(0, 3).map(action => <li key={action} className="break-words">{action}</li>)}</ul>
        : <p className="text-sm text-gray-600">No supported next step was identified in this report.</p>}
      {actions.length > 3 && <details><summary className="cursor-pointer text-sm text-gray-600">More next steps ({actions.length - 3})</summary><ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6">{actions.slice(3).map(action => <li key={action} className="break-words">{action}</li>)}</ul></details>}
    </div>
    {analysis && <details className="space-y-2 text-xs text-gray-600"><summary className="cursor-pointer">Interpretation source and cautions</summary><p>{getAIAnalysisProvenance(analysis)}</p>{analysis.risks.length > 0 && <ul className="list-disc space-y-2 pl-5">{analysis.risks.map((risk, index) => <li key={index} className="break-words">{risk}</li>)}</ul>}</details>}
  </section>
}
