"use client"

import { useState } from "react"
import { X } from "lucide-react"
import { correlationRequest, createDecision, type DecisionCreatePayload, type DecisionRecord } from "@/lib/api"
import { AnalysisActionForm } from "@/features/decisions/components/analysis-action-form"
import { MetricPlanForm } from "@/features/decisions/components/metric-plan-form"
import { decisionCreationKey } from "@/features/decisions/lib/creation-request"
import type { BusinessReport } from "@/features/reports/types"

export function ReportDecisionComposer({ report, userId, workspaceId, onCreated, onCancel }: {
  report: BusinessReport; userId: string; workspaceId?: string
  onCreated: (decision: DecisionRecord) => void; onCancel: () => void
}) {
  const metrics = report.metrics.filter(m => m.value !== null)
  const impact = report.impact_analysis
  const hasTargets = !impact && metrics.length >= 2
  const [automatic, setAutomatic] = useState(hasTargets)
  const [outcome, setOutcome] = useState((impact && metrics.find(m => m.id === impact.outcome?.id)?.id) || metrics[0]?.id || "")
  const evidence = impact?.headline || report.business_question || report.name
  if (!report.report_id || !metrics.length) return null
  const id = report.report_id
  return <section aria-label={impact ? "New follow-up decision" : "New decision"} className="space-y-4 print:hidden">
    <div className="flex flex-wrap items-center gap-4">
      <h4 className="font-semibold">{impact ? "New follow-up decision" : "New decision"}</h4>
      {hasTargets && <label className="text-sm">Review method <select className="rounded-md border bg-white p-2" value={automatic ? "targets" : "manual"} onChange={e => setAutomatic(e.target.value === "targets")}>
        <option value="targets">Track two metric targets</option><option value="manual">Review the result myself</option>
      </select></label>}
      {automatic && <button type="button" onClick={onCancel} className="inline-flex items-center gap-1 text-sm"><X size={16} />Cancel</button>}
    </div>
    {automatic ? <MetricPlanForm userId={userId} workspace={workspaceId} datasets={[]} report={report} reportId={id} onCreated={onCreated} />
      : <AnalysisActionForm evidence={evidence} onCancel={onCancel} onSave={async draft => {
        const { decision_payload } = await correlationRequest<{ decision_payload: DecisionCreatePayload }>(userId,
          `/business-reports/${encodeURIComponent(id)}/decision-evidence`, { method: "POST", body: JSON.stringify({
            ...draft, outcome_metric: outcome, reasoning: evidence.trim().length >= 3 ? evidence : draft.action,
          }) }, workspaceId)
        const key = await decisionCreationKey(JSON.stringify([userId, workspaceId, decision_payload]))
        onCreated(await createDecision(decision_payload, userId, workspaceId, key))
      }}>
        <label className="text-sm">Result to review<select className="mt-1 block w-full rounded-md border bg-white p-2" value={outcome} onChange={e => setOutcome(e.target.value)}>
          {metrics.map(m => <option key={m.id} value={m.id}>{m.dataset_label} / {m.label}</option>)}
        </select></label>
      </AnalysisActionForm>}
  </section>
}
