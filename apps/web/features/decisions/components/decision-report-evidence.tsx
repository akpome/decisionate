"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { RefreshCw } from "lucide-react"
import { correlationRequest } from "@/lib/api"
import type { BusinessReport } from "@/features/reports/types"
import { selectedReportMetrics } from "../lib/report-metric-scope"

type SavedReport = { report_id: string; name: string; created_at: string }
type LoadState<T> = { key: string; data: T; loading: boolean; error: string }
const input = "mt-1 min-h-10 w-full min-w-0 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
const message = (error: unknown) => error instanceof Error ? error.message : "Report evidence is unavailable."

export function useDecisionReportEvidence(userId: string | undefined, workspaceId: string | undefined, enabled: boolean) {
  const scope = JSON.stringify([userId, workspaceId])
  const [choice, setChoice] = useState({ scope: "", id: "" })
  const [retry, setRetry] = useState(0)
  const [history, setHistory] = useState<LoadState<SavedReport[]>>({ key: "", data: [], loading: false, error: "" })
  const [detail, setDetail] = useState<LoadState<BusinessReport | null>>({ key: "", data: null, loading: false, error: "" })
  const reportId = choice.scope === scope ? choice.id : ""
  const detailKey = JSON.stringify([scope, reportId])

  useEffect(() => {
    if (!userId || !enabled) return
    let current = true
    async function load() {
      setHistory({ key: scope, data: [], loading: true, error: "" })
      try {
        const data = await correlationRequest<SavedReport[]>(userId!, "/business-reports", {}, workspaceId)
        if (current) setHistory({ key: scope, data, loading: false, error: "" })
      } catch (error) {
        if (current) setHistory({ key: scope, data: [], loading: false, error: message(error) })
      }
    }
    void load()
    return () => { current = false }
  }, [userId, workspaceId, scope, enabled, retry])

  useEffect(() => {
    if (!userId || !enabled || !reportId) return
    let current = true
    async function load() {
      setDetail({ key: detailKey, data: null, loading: true, error: "" })
      try {
        const data = await correlationRequest<BusinessReport>(userId!, `/business-reports/${encodeURIComponent(reportId)}`, {}, workspaceId)
        if (current) setDetail({ key: detailKey, data: { ...data, metrics: selectedReportMetrics(data) }, loading: false, error: "" })
      } catch (error) {
        if (current) setDetail({ key: detailKey, data: null, loading: false, error: message(error) })
      }
    }
    void load()
    return () => { current = false }
  }, [userId, workspaceId, enabled, reportId, detailKey, retry])

  return {
    reports: history.key === scope ? history.data : [],
    loadingList: enabled && (history.key !== scope || history.loading),
    listError: history.key === scope ? history.error : "",
    reportId,
    report: reportId && detail.key === detailKey ? detail.data : null,
    loadingReport: Boolean(reportId) && (detail.key !== detailKey || detail.loading),
    reportError: reportId && detail.key === detailKey ? detail.error : "",
    select: (id: string) => setChoice({ scope, id }),
    retry: () => setRetry(value => value + 1),
  }
}

export function DecisionReportEvidence({ evidence, outcome, onReportChange, onOutcomeChange, disabled }: {
  evidence: ReturnType<typeof useDecisionReportEvidence>; outcome: string
  onReportChange: (id: string) => void; onOutcomeChange: (id: string) => void; disabled: boolean
}) {
  const report = evidence.report
  return <section aria-label="Report evidence" className="min-w-0 space-y-3 border-y border-gray-200 py-4 lg:col-span-3">
    <div>
      <label htmlFor="decision-report" className="block text-xs font-medium text-gray-600">Saved report</label>
      <select id="decision-report" className={input} value={evidence.reportId} disabled={disabled || evidence.loadingList} onChange={event => onReportChange(event.target.value)}>
        <option value="">{evidence.loadingList ? "Loading saved reports..." : "No saved report"}</option>
        {evidence.reports.map(item => <option key={item.report_id} value={item.report_id}>{item.name} / {item.created_at.slice(0, 10)}</option>)}
      </select>
    </div>
    {(evidence.listError || evidence.reportError) && <div role="alert" className="flex items-start justify-between gap-3 text-sm text-red-700">
      <span className="min-w-0 break-words">{evidence.reportError || evidence.listError}</span>
      <button type="button" title="Retry report evidence" aria-label="Retry report evidence" disabled={disabled || evidence.loadingList || evidence.loadingReport} onClick={evidence.retry} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-red-200"><RefreshCw size={16} /></button>
    </div>}
    {evidence.loadingReport && <p role="status" className="text-sm text-gray-500">Loading report evidence...</p>}
    {report && <>
      <p className="break-words text-sm font-medium">{report.business_question}</p>
      <p className="text-xs text-gray-500">{report.window.start} to {report.window.end} / {report.dataset_count} datasets / <Link href={`/dashboard/reports?report=${encodeURIComponent(evidence.reportId)}`} className="text-blue-700 underline">View saved report</Link></p>
      <ul className="space-y-1 text-xs text-gray-600">{report.metrics.map(metric => <li key={metric.id} className="break-words">{metric.dataset_label} / {metric.label}</li>)}</ul>
      {report.status !== "ready" && <p role="alert" className="text-sm text-amber-800">Resolve cross-dataset coverage before using this report as decision evidence.</p>}
      {report.warnings.map((warning, index) => <p key={index} className="break-words text-xs text-amber-800">{warning}</p>)}
      <div>
        <label htmlFor="decision-report-outcome" className="block text-xs font-medium text-gray-600">Outcome metric</label>
        <select id="decision-report-outcome" className={input} required value={outcome} disabled={disabled || report.status !== "ready"} onChange={event => onOutcomeChange(event.target.value)}>
          <option value="" disabled>Choose outcome metric</option>
          {report.metrics.filter(metric => metric.value !== null).map(metric => <option key={metric.id} value={metric.id}>{metric.dataset_label} / {metric.label}</option>)}
        </select>
      </div>
    </>}
  </section>
}
