"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowLeft, Check, LoaderCircle, Play, Plus, Save, Target, Trash2, X } from "lucide-react"
import { SearchableSelect } from "@/components/searchable-select"
import { correlationRequest } from "@/lib/api"
import { AnalysisTools } from "@/features/reports/analysis-tools"
import { AnalysisFailedError, AnalysisUnavailableError, analysisPhaseLabel, waitForAnalysis, type AnalysisJob } from "@/features/reports/analysis-jobs"
import { command, field, primary, WrappingSelect } from "./amount-source"
import { SeparateDatasetSetup, SingleDatasetSetup } from "./performance-setup"
import { PerformanceResults } from "./performance-results"
import { GrowthConfirmation, GrowthSetup } from "./growth-setup"
import { GrowthResults } from "./growth-results"
import { blankItem, isMoneyDefinition, missingSetup, newPerformance, performancePath, sameDatasetLayout, toolLabels, type ToolDefinition, type ToolKind, type ToolResult as PerformanceResult, type PerformanceDefinition } from "./types"

type History = { analyses: { analysis_id: string; name: string; created_at: string }[]; next_offset: number | null }
type DecisionDraft = { title: string; action: string; expected_outcome: string; review_date: string }

export function PerformanceWorkspace({ kind, userId, workspaceId, canSave, canManage, canDecide }: {
  kind: ToolKind; userId: string; workspaceId?: string; canSave: boolean; canManage: boolean; canDecide: boolean
}) {
  const [definition, setDefinition] = useState(() => newPerformance(kind))
  const [layout, setLayout] = useState<"one" | "separate">("one")
  const [view, setView] = useState<"setup" | "results">("setup")
  const [result, setResult] = useState<PerformanceResult | null>(null)
  const [history, setHistory] = useState<History>({ analyses: [], next_offset: null })
  const [historyError, setHistoryError] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState("")
  const [jobId, setJobId] = useState<string | null>(null)
  const [decision, setDecision] = useState<DecisionDraft | null>(null)
  const active = useRef<AbortController | null>(null), mounted = useRef(true), pending = useRef(false), requestKey = useRef<string | null>(null)
  const request = useCallback(<T,>(path: string, init?: RequestInit) => correlationRequest<T>(userId, `/performance-analyses${path}`, init, workspaceId), [userId, workspaceId])
  const loadHistory = useCallback(async (offset = 0) => {
    try {
      const data = await request<History>(`?kind=${kind}&offset=${offset}`)
      if (mounted.current) { setHistory(previous => ({ ...data, analyses: offset ? [...previous.analyses, ...data.analyses] : data.analyses })); setHistoryError("") }
    } catch { if (mounted.current) setHistoryError("Saved comparisons could not be loaded.") }
  }, [kind, request])
  useEffect(() => {
    mounted.current = true
    const controller = new AbortController(); active.current = controller
    const timer = setTimeout(() => {
    void loadHistory()
    const params = new URLSearchParams(window.location.search), savedId = params.get("comparison"), resumeId = params.get("job")
    if (savedId || resumeId) {
      setBusy(true); pending.current = true; setPhase("loading"); setJobId(resumeId)
      void (savedId ? request<PerformanceResult>(`/${encodeURIComponent(savedId)}`, { signal: controller.signal })
        : waitForAnalysis<PerformanceResult>(request, resumeId!, { signal: controller.signal, onUpdate: job => {
          if (!controller.signal.aborted) { setPhase(job.phase); if (["failed", "cancelled"].includes(job.status)) setJobId(null) }
        } }))
        .then(data => { if (!controller.signal.aborted) {
          if (data.definition.kind !== kind) { window.location.replace(`${performancePath(data.definition.kind)}?${params}`); return }
          setDefinition(data.definition); setResult(data); setLayout(sameDatasetLayout(data.definition) ? "one" : "separate"); setView("results")
        } }).catch(failure => { if (!controller.signal.aborted) { setError(failure.message); if (failure instanceof AnalysisUnavailableError) setJobId(null) } })
        .finally(() => { if (!controller.signal.aborted) { setBusy(false); pending.current = false } })
    }
    }, 0)
    return () => { clearTimeout(timer); mounted.current = false; controller.abort(); active.current?.abort() }
  }, [kind, request, loadHistory])

  function change(value: ToolDefinition) {
    active.current?.abort(); requestKey.current = null
    setDefinition({ ...value, amounts_confirmed: false }); setResult(null); setJobId(null); setDecision(null); setError("")
    window.history.replaceState(null, "", performancePath(kind))
  }
  async function preview() {
    if (pending.current || missingSetup(definition)) return
    pending.current = true; setBusy(true); setError(""); setPhase("queued")
    const controller = new AbortController(); active.current?.abort(); active.current = controller
    try {
      let id = jobId
      if (!id) {
        requestKey.current ||= crypto.randomUUID()
        const job = await request<AnalysisJob<PerformanceResult>>("/jobs", { method: "POST", body: JSON.stringify(definition), headers: { "Idempotency-Key": requestKey.current }, signal: controller.signal })
        id = job.job_id
        if (controller.signal.aborted) return
        setJobId(id); window.history.replaceState(null, "", `${performancePath(kind)}?job=${encodeURIComponent(id)}`)
      }
      const data = await waitForAnalysis<PerformanceResult>(request, id, { signal: controller.signal, onUpdate: job => {
        if (!controller.signal.aborted) {
          setPhase(job.phase)
          if (["failed", "cancelled"].includes(job.status)) { setJobId(null); requestKey.current = null }
        }
      } })
      if (!controller.signal.aborted) { setResult(data); setView("results") }
    } catch (failure) { if (!controller.signal.aborted) {
      if (failure instanceof AnalysisFailedError || failure instanceof AnalysisUnavailableError) { setJobId(null); requestKey.current = null }
      setError(failure instanceof Error ? failure.message : "The comparison could not be completed.")
    } } finally { if (!controller.signal.aborted) { pending.current = false; setBusy(false) } }
  }
  async function action(work: () => Promise<void>) {
    if (pending.current) return
    pending.current = true; setBusy(true); setError(""); setPhase("")
    try { await work() } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "The request could not be completed.") }
    finally { pending.current = false; if (mounted.current) setBusy(false) }
  }
  function reset() { change(newPerformance(kind)); setLayout("one"); setView("setup") }
  const setupIssue = missingSetup(definition), returns = kind === "return", context = { userId, workspaceId }
  const sourceQuestion = `Where are your revenue and ${returns ? "spending" : "costs"} figures stored?`
  return <div className="min-w-0 space-y-5" aria-busy={busy}>
    <header className="border-b border-gray-200 pb-4"><h1 className="text-2xl font-semibold">Business Analysis</h1></header>
    <AnalysisTools active={kind} />
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{toolLabels[kind]}</h2>
      {result && <button className={command} disabled={busy} onClick={reset}><Plus size={16} />New comparison</button>}
    </div>
    <details className="text-sm"><summary className="w-fit cursor-pointer py-2 text-gray-600">Saved comparisons</summary><div className="flex max-w-3xl items-end gap-3 pt-2">
      <div className="min-w-0 flex-1"><SearchableSelect label="Saved comparison" value={result?.analysis_id || null} options={history.analyses.map(item => ({ value: item.analysis_id, label: `${item.name} / saved ${item.created_at.slice(0, 10)}` }))} placeholder="Choose a saved comparison" disabled={busy}
        onChange={id => void action(async () => {
          const data = await request<PerformanceResult>(`/${encodeURIComponent(id)}`)
          if (!mounted.current) return
          setResult(data); setDefinition(data.definition); setLayout(sameDatasetLayout(data.definition) ? "one" : "separate"); setJobId(null); setDecision(null); setView("results"); requestKey.current = null
          window.history.replaceState(null, "", `${performancePath(kind)}?comparison=${encodeURIComponent(id)}`)
        })} footer={history.next_offset !== null && <button type="button" disabled={busy} className={command} onClick={() => void loadHistory(history.next_offset!)}>Load more</button>} /></div>
      {result?.analysis_id && canManage && <button className={command} disabled={busy} title="Delete saved comparison" aria-label="Delete saved comparison" onClick={() => {
        if (window.confirm("Delete this saved comparison? Linked decisions will be kept.")) void action(async () => {
          await request(`/${result.analysis_id}`, { method: "DELETE" }); if (mounted.current) reset(); await loadHistory()
        })
      }}><Trash2 size={16} /></button>}
    </div>{historyError && <p role="alert" className="mt-3 text-amber-900">{historyError} <button className={command} disabled={busy} onClick={() => void loadHistory()}>Retry</button></p>}</details>
    {error && <p role="alert" className="break-words rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {busy && phase && <div role="status" className="flex flex-wrap items-center gap-3 text-sm"><LoaderCircle size={16} className="animate-spin" />{analysisPhaseLabel(phase)}
      {jobId && <button className={command} onClick={() => {
        active.current?.abort(); pending.current = false; setBusy(false); setPhase(""); requestKey.current = null
        void request(`/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" }).catch(failure => { if (mounted.current) setError(failure.message) })
        setJobId(null); window.history.replaceState(null, "", performancePath(kind))
      }}><X size={16} />Cancel</button>}
    </div>}
    {view === "setup" && <form onSubmit={event => { event.preventDefault(); void preview() }}>
      <fieldset disabled={busy} className="min-w-0 space-y-6">
        {isMoneyDefinition(definition) ? <>
        <div className="grid min-w-0 items-end gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <div className="min-w-0 sm:col-span-3 lg:col-span-2"><WrappingSelect label={sourceQuestion} value={layout} options={[
            { value: "one", label: "Both in the same dataset" },
            { value: "separate", label: `Revenue and ${returns ? "spending" : "costs"} in different datasets` },
          ]} onChange={value => {
            const next = value as typeof layout
            if (definition.items.some(item => item.revenue.metric_key || item.costs.some(cost => cost.metric_key)) && !window.confirm(`Change the source selection and clear your selected revenue and ${returns ? "spending" : "costs"}?`)) return
            setLayout(next); change({ ...definition, group_column: null, items: next === "one" ? [blankItem("Business")] : [blankItem("Comparison 1"), blankItem("Comparison 2")] })
          }} /></div>
          <label className="text-xs font-medium text-gray-600">From<input className={field} type="date" required value={definition.date_range.start} onChange={event => change({ ...definition, date_range: { ...definition.date_range, start: event.target.value } })} /></label>
          <label className="text-xs font-medium text-gray-600">To<input className={field} type="date" required min={definition.date_range.start} value={definition.date_range.end} onChange={event => change({ ...definition, date_range: { ...definition.date_range, end: event.target.value } })} /></label>
          <label className="text-xs font-medium text-gray-600">Currency<select className={field} value={definition.currency} onChange={event => change({ ...definition, currency: event.target.value })}>{["CAD", "USD", "EUR", "GBP", "AUD", "NZD", "JPY", "INR", "NGN", "ZAR", "BRL", "MXN", "SGD", "CHF"].map(code => <option key={code}>{code}</option>)}</select></label>
        </div>
        <div className="border-t border-gray-200 pt-5">{layout === "one" ? <SingleDatasetSetup context={context} definition={definition} onChange={change} /> : <SeparateDatasetSetup context={context} definition={definition} onChange={change} />}</div>
        <div className="space-y-4 border-t border-gray-200 pt-5">
          {returns && <div className="max-w-xl"><WrappingSelect label="Where do your revenue figures come from?" value={definition.revenue_basis} options={[
            { value: "assigned_sales", label: "Sales records with one channel per sale" },
            { value: "platform_reported", label: "Each ad platform's own sales figures" },
          ]} onChange={value => change({ ...definition, revenue_basis: value as PerformanceDefinition["revenue_basis"] })} /></div>}
          <div className="max-w-4xl space-y-2 text-sm leading-6">
            <label className="flex items-start gap-3"><input type="checkbox" aria-describedby="performance-record-checks" className="mt-1 h-4 w-4 shrink-0" checked={definition.amounts_confirmed} onChange={event => setDefinition({ ...definition, amounts_confirmed: event.target.checked })} />
              <span>I have checked the following:</span>
            </label>
            <ul id="performance-record-checks" className="ml-7 list-disc space-y-1 pl-4">
              <li>The records cover the selected dates and all amounts are in {definition.currency}.</li>
              <li>Revenue has refunds, discounts and tax removed.</li>
              <li>{returns ? "Spending is counted only once." : "Sales and costs are counted only once."}</li>
              {returns && <li>{definition.revenue_basis === "assigned_sales"
                ? "Each sale is counted once, under only one channel. All channels use the same tracking method."
                : "I understand that the same sale may appear in more than one platform's report."}</li>}
            </ul>
          </div>
        </div>
        </> : <>
          <GrowthSetup definition={definition} onChange={change} context={context} />
          <label className="flex max-w-4xl items-start gap-3 border-t border-gray-200 pt-5 text-sm leading-6"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={definition.amounts_confirmed} onChange={event => setDefinition({ ...definition, amounts_confirmed: event.target.checked })} />
            <span><GrowthConfirmation definition={definition} /></span>
          </label>
        </>}
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-gray-200 py-5">
          <p id="performance-setup-status" role="status" className="text-sm text-gray-600">{setupIssue}</p>
          <button className={primary} type="submit" disabled={busy || Boolean(setupIssue)} aria-describedby={setupIssue ? "performance-setup-status" : undefined}><Play size={16} />{jobId ? "Resume comparison" : isMoneyDefinition(definition) ? "Compare results" : kind === "cashflow" ? "Preview cash plan" : "Show results"}</button>
        </div>
      </fieldset>
    </form>}
    {view === "results" && result && <>
      {"highlights" in result ? <GrowthResults result={result} /> : <PerformanceResults result={result} />}
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <button className={command} disabled={busy} onClick={() => { change(definition); setView("setup") }}><ArrowLeft size={16} />Edit comparison</button>
        {canSave && !result.analysis_id && result.rows.some(row => row.ready) && <button className={primary} disabled={busy || !jobId} onClick={() => void action(async () => {
          setPhase("")
          const data = await request<PerformanceResult>(`/jobs/${jobId}/save`, { method: "POST" })
          if (!mounted.current) return
          setResult(data); window.history.replaceState(null, "", `${performancePath(kind)}?comparison=${data.analysis_id}`); await loadHistory()
        })}><Save size={16} />Save comparison</button>}
        {result.analysis_id && <span className="inline-flex items-center gap-2 text-sm text-emerald-800"><Check size={16} />Saved</span>}
        {result.decision_id ? <Link className={command} href={`/dashboard/decisions/${result.decision_id}`}>Open decision</Link> : result.analysis_id && canDecide && !decision && <button className={command} disabled={busy} onClick={() => setDecision({ title: "", action: "", expected_outcome: "", review_date: "" })}><Target size={16} />Create decision</button>}
      </div>
      {decision && <form className="space-y-4 border-t border-gray-200 pt-5" onSubmit={event => { event.preventDefault(); void action(async () => {
        const data = await request<{ decision_id: number }>(`/${result.analysis_id}/decision`, { method: "POST", body: JSON.stringify(decision) })
        if (mounted.current) { setResult({ ...result, decision_id: data.decision_id }); setDecision(null) }
      }) }}><h3 className="text-lg font-semibold">Create decision</h3>
        <fieldset disabled={busy} className="grid min-w-0 gap-4 sm:grid-cols-2">
          <label className="text-xs font-medium text-gray-600">Decision name<input className={field} required minLength={3} maxLength={200} value={decision.title} onChange={event => setDecision({ ...decision, title: event.target.value })} /></label>
          <label className="text-xs font-medium text-gray-600">Review date<input className={field} type="date" required value={decision.review_date} onChange={event => setDecision({ ...decision, review_date: event.target.value })} /></label>
          <label className="text-xs font-medium text-gray-600">Action to take<textarea className={field} required minLength={8} maxLength={5000} value={decision.action} onChange={event => setDecision({ ...decision, action: event.target.value })} /></label>
          <label className="text-xs font-medium text-gray-600">Expected result<textarea className={field} required minLength={8} maxLength={3000} value={decision.expected_outcome} onChange={event => setDecision({ ...decision, expected_outcome: event.target.value })} /></label>
          <div className="flex flex-wrap gap-3"><button className={primary} type="submit"><Target size={16} />Create decision</button><button className={command} type="button" onClick={() => setDecision(null)}><X size={16} />Cancel</button></div>
        </fieldset>
      </form>}
    </>}
  </div>
}
