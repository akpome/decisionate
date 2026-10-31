"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowLeft, ArrowRight, Check, LoaderCircle, Plus, Play, Save, Target, Trash2, X } from "lucide-react"
import { correlationRequest } from "@/lib/api"
import { SearchableSelect } from "@/components/searchable-select"
import { AnalysisUnavailableError, analysisPhaseLabel, waitForAnalysis, type AnalysisJob } from "@/features/reports/analysis-jobs"
import { SourcePicker } from "./source-picker"
import { amount, blankSelection, missingSelection, nextMonday, type BudgetDefinition, type BudgetResult } from "./types"
import styles from "./planner.module.css"

type SavedPlans = { plans: { plan_id: string; name: string; created_at: string }[]; next_offset: number | null }
export function BudgetPlanner({ userId, workspaceId, canSave, canDecide }: { userId: string; workspaceId?: string; canSave: boolean; canDecide: boolean }) {
  const [definition, setDefinition] = useState<BudgetDefinition>(() => ({ name: "Budget plan", outcome: blankSelection(), options: [1, 2].map(index => ({ ...blankSelection(), name: `Option ${index}` })), controls: [], budget: 0, currency: "CAD", start_date: nextMonday(), weeks: 4, comparable_spend_confirmed: false, business_context_confirmed: false }))
  const [result, setResult] = useState<BudgetResult | null>(null)
  const [step, setStep] = useState(0)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState("")
  const [jobId, setJobId] = useState<string | null>(null)
  const [saved, setSaved] = useState<SavedPlans>({ plans: [], next_offset: null })
  const [decision, setDecision] = useState<{ title: string; action: string; expected_outcome: string; review_date: string } | null>(null)
  const active = useRef<AbortController | null>(null)
  const pending = useRef(false)
  const requestKey = useRef<string | null>(null)
  const mounted = useRef(true)
  const request = useCallback(<T,>(path: string, init?: RequestInit) => correlationRequest<T>(userId, `/budget-plans${path}`, init, workspaceId), [userId, workspaceId])
  const loadPlans = useCallback(async (offset = 0) => {
    const data = await request<SavedPlans>(`?offset=${offset}`)
    if (mounted.current) setSaved(previous => ({ ...data, plans: offset ? [...previous.plans, ...data.plans] : data.plans }))
  }, [request])
  useEffect(() => {
    mounted.current = true
    void loadPlans().catch(failure => { if (mounted.current) setError(failure.message) })
    return () => { mounted.current = false; active.current?.abort() }
  }, [loadPlans])
  function change(next: BudgetDefinition) {
    active.current?.abort(); pending.current = false; requestKey.current = null; setBusy(false); setDefinition(next); setResult(null); setJobId(null); setDecision(null); setError("")
  }
  async function preview() {
    if (pending.current) return
    pending.current = true
    const controller = new AbortController(); active.current?.abort(); active.current = controller
    setBusy(true); setError(""); setPhase("queued")
    try {
      let id = result ? null : jobId
      if (result) { requestKey.current = null; setResult(null); setJobId(null); setDecision(null) }
      if (!id) {
        requestKey.current ||= crypto.randomUUID()
        const job = await request<AnalysisJob<BudgetResult>>("/jobs", { method: "POST", body: JSON.stringify(definition), headers: { "Idempotency-Key": requestKey.current }, signal: controller.signal })
        id = job.job_id; setJobId(id)
      }
      const data = await waitForAnalysis<BudgetResult>(request, id, { signal: controller.signal, onUpdate: job => { setPhase(job.phase); if (["failed", "cancelled"].includes(job.status)) { setJobId(null); requestKey.current = null } } })
      if (!controller.signal.aborted) { setResult(data); setStep(1) }
    } catch (failure) { if (!controller.signal.aborted) {
      if (failure instanceof AnalysisUnavailableError) { setJobId(null); requestKey.current = null }
      setError(failure instanceof Error ? failure.message : "Preview could not be completed.")
    } }
    finally { if (!controller.signal.aborted) { setBusy(false); pending.current = false } }
  }
  async function action(work: () => Promise<void>) {
    if (pending.current) return
    pending.current = true
    setBusy(true); setError("")
    try { await work() } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "The request could not be completed.") }
    finally { pending.current = false; if (mounted.current) setBusy(false) }
  }
  const picker = { userId, workspaceId }
  const disabled = missingSelection(definition) || definition.budget <= 0 || !definition.start_date || !definition.name.trim() || !/^[A-Z]{3}$/.test(definition.currency)
  return <div className={styles.planner} aria-busy={busy}>
    <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-5"><h1>Budget Planner</h1><Link href="/dashboard/help">Help &amp; Support</Link></header>
    <div className="flex flex-wrap items-end gap-3 py-5">
      <div className="min-w-0 flex-1 sm:max-w-lg"><SearchableSelect label="Saved plans" options={saved.plans.map(item => ({ value: item.plan_id, label: `${item.name} (${item.created_at.slice(0, 10)})` }))} value={result?.plan_id || null} placeholder="Unsaved plan" disabled={busy}
        onChange={id => void action(async () => { const data = await request<BudgetResult>(`/${id}`); if (mounted.current) { setResult(data); setDefinition(data.definition); setJobId(null); setDecision(null); setStep(2) } })}
        footer={saved.next_offset !== null && <button disabled={busy} onClick={() => void action(() => loadPlans(saved.next_offset!))}>Load more plans</button>} /></div>
      <button disabled={busy} onClick={() => { change({ ...definition, name: "Budget plan" }); setStep(0) }}><Plus size={16} />New plan</button>
      {result?.plan_id && canSave && <button disabled={busy} title="Delete saved plan" aria-label="Delete saved plan" onClick={() => {
        if (window.confirm("Delete this saved plan? Its linked decision will remain.")) void action(async () => { await request(`/${result.plan_id}`, { method: "DELETE" }); if (mounted.current) { setResult(null); setStep(0) }; await loadPlans() })
      }}><Trash2 size={16} /></button>}
    </div>
    {error && <p role="alert" className="border-l-2 border-red-600 bg-red-50 p-3 text-red-800">{error}</p>}
    <nav aria-label="Budget planning steps" className="flex flex-wrap gap-2 border-b py-3">{["Set up budget", "Check evidence", "Compare allocations"].map((label, index) =>
      <button key={label} disabled={busy || index > 0 && !result || index === 2 && result?.status !== "ready"} aria-current={step === index ? "step" : undefined} onClick={() => setStep(index)}>{index + 1}. {label}</button>)}</nav>
    {step === 0 && <form onSubmit={event => { event.preventDefault(); void preview() }}>
      <fieldset disabled={busy} className="space-y-6 py-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <label>Plan name<input required maxLength={120} value={definition.name} onChange={event => change({ ...definition, name: event.target.value })} /></label>
          <label>Total budget<input type="number" required min="0.01" max="1000000000000" step="0.01" value={definition.budget || ""} onChange={event => change({ ...definition, budget: Number(event.target.value) })} /></label>
          <label>Currency<select value={definition.currency} onChange={event => change({ ...definition, currency: event.target.value })}>{["CAD", "USD", "EUR", "GBP", "AUD", "NZD", "JPY", "INR", "NGN", "ZAR", "BRL", "MXN", "SGD", "CHF"].map(code => <option key={code}>{code}</option>)}</select></label>
          <label>Starts on Monday<input type="date" required value={definition.start_date} onChange={event => change({ ...definition, start_date: event.target.value })} /></label>
          <label>Planning weeks<input type="number" required min={1} max={13} value={definition.weeks} onChange={event => change({ ...definition, weeks: Number(event.target.value) })} /></label>
        </div>
        <section className="border-t pt-5"><h2>Result to improve</h2><SourcePicker {...picker} label="Outcome" value={definition.outcome} onChange={outcome => change({ ...definition, outcome })} /></section>
        <section className="border-t pt-5"><h2>Spending options</h2>
          {definition.options.map((option, index) => <div key={index} className="space-y-4 border-b py-5">
            <div className="flex items-end gap-3"><label className="min-w-0 flex-1">Option {index + 1} name<input required maxLength={80} value={option.name} onChange={event => change({ ...definition, options: definition.options.map((item, at) => at === index ? { ...item, name: event.target.value } : item) })} /></label>
              <button type="button" disabled={definition.options.length <= 2} title={`Remove ${option.name}`} aria-label={`Remove ${option.name}`} onClick={() => change({ ...definition, options: definition.options.filter((_, at) => at !== index) })}><Trash2 size={16} /></button></div>
            <SourcePicker {...picker} spending label={option.name} value={option} onChange={selection => change({ ...definition, options: definition.options.map((item, at) => at === index ? { ...item, ...selection, dimension_filter: selection.dimension_filter } : item) })} />
            <details><summary>Spending limits (optional)</summary><div className="grid gap-4 pt-3 sm:grid-cols-2">{(["minimum", "maximum"] as const).map(bound => <label key={bound}>{bound === "minimum" ? "Minimum" : "Maximum"} for the entire plan<input type="number" min={0} step="0.01" value={option[bound] ?? ""} onChange={event => change({ ...definition, options: definition.options.map((item, at) => at === index ? { ...item, [bound]: event.target.value === "" ? undefined : Number(event.target.value) } : item) })} /></label>)}</div></details>
          </div>)}
          <button type="button" disabled={definition.options.length >= 6} className="mt-4" onClick={() => change({ ...definition, options: [...definition.options, { ...blankSelection(), name: `Option ${definition.options.length + 1}` }] })}><Plus size={16} />Add spending option</button>
        </section>
        <section className="border-t pt-5"><h2>Other business influences</h2>
          {definition.controls.map((control, index) => <div key={index} className="space-y-3 border-b py-4"><SourcePicker {...picker} label={`Business influence ${index + 1}`} value={control} onChange={selection => change({ ...definition, controls: definition.controls.map((item, at) => at === index ? selection : item) })} /><button type="button" title="Remove business influence" aria-label={`Remove business influence ${index + 1}`} onClick={() => change({ ...definition, controls: definition.controls.filter((_, at) => at !== index) })}><Trash2 size={16} /></button></div>)}
          <button type="button" disabled={definition.controls.length >= 3} onClick={() => change({ ...definition, controls: [...definition.controls, blankSelection()] })}><Plus size={16} />Add business influence</button>
        </section>
        <div className="space-y-3 border-t pt-5">
          <label className={styles.check}><input type="checkbox" checked={definition.comparable_spend_confirmed} onChange={event => change({ ...definition, comparable_spend_confirmed: event.target.checked })} />These spending options do not overlap and all amounts use {definition.currency}.</label>
          <label className={styles.check}><input type="checkbox" checked={definition.business_context_confirmed} onChange={event => change({ ...definition, business_context_confirmed: event.target.checked })} />I have considered other influences, such as promotions and availability. Any added context is not itself a result of this spending.</label>
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3 border-t py-5"><button className={styles.primary} disabled={busy || disabled} type="submit">{busy ? <LoaderCircle className="animate-spin" size={16} /> : <Play size={16} />}{result ? "Refresh preview" : jobId ? "Resume preview" : "Preview budget"}</button>
        {busy && <><span role="status">{analysisPhaseLabel(phase)}</span><button type="button" onClick={() => { active.current?.abort(); pending.current = false; requestKey.current = null; setBusy(false); if (jobId) void request(`/jobs/${jobId}`, { method: "DELETE" }).catch(failure => { if (mounted.current) setError(failure.message) }); setJobId(null) }}><X size={16} />Cancel</button></>}
      </div>
    </form>}
    {step === 1 && result && <section className="space-y-5 py-6"><h2>{result.status === "ready" ? "Evidence supports a cautious test" : "More evidence needed"}</h2>
      {result.history && <p>{result.history.weeks} shared weeks: {result.history.start} to {result.history.end}.</p>}
      <ul className="list-disc space-y-3 pl-5">{result.checks.map(check => <li key={check}>{check}</li>)}</ul>
      <p>No budget changes have been made.</p>
      <div className="flex flex-wrap gap-3"><button onClick={() => setStep(0)}><ArrowLeft size={16} />Edit setup</button>{result.status === "ready" && <button className={styles.primary} onClick={() => setStep(2)}>Compare allocations<ArrowRight size={16} /></button>}</div>
    </section>}
    {step === 2 && result?.status === "ready" && <section className="space-y-6 py-6">
      <div><h2>{result.definition.name}</h2><p>{result.definition.weeks} weeks from {result.definition.start_date} / {amount(result.definition.budget, result.definition.currency)} total</p>
        <p className="mt-2 text-sm text-gray-600">{result.plan_id ? "Saved estimate" : "Preview calculated"}: {result.generated_at?.slice(0, 10)}{result.outcome?.dataset_label ? ` / Result: ${result.outcome.dataset_label} / ${result.outcome.label}` : ""}</p></div>
      <div className="grid gap-6 border-y py-5 lg:grid-cols-2"><div><h3>Estimated additional {result.outcome?.label || "result"}</h3><p className="text-2xl font-semibold text-emerald-700">{amount(result.estimate!.additional_result, result.outcome?.currency)}</p><p>Model range: {amount(result.estimate!.lower, result.outcome?.currency)} to {amount(result.estimate!.upper, result.outcome?.currency)}</p></div><p>Compared with keeping the recent spending mix at the same total budget. This is a candidate for a measured test, not a guaranteed improvement.</p></div>
      <div className="flex flex-wrap gap-5 text-sm"><span><i className="mr-2 inline-block h-3 w-3 bg-gray-400" />Recent mix at this budget</span><span><i className="mr-2 inline-block h-3 w-3 bg-emerald-600" />Suggested test</span></div>
      {result.allocations.map(item => <div key={item.name} className="space-y-2"><h3>{item.name}</h3>{(["current", "suggested"] as const).map(kind => <div key={kind} className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-3"><div className="h-4 bg-gray-100" aria-hidden="true"><div className={`h-4 ${kind === "current" ? "bg-gray-400" : "bg-emerald-600"}`} style={{ width: `${100 * item[kind] / result.definition.budget}%` }} /></div><span className="text-right text-sm"><span className="sr-only">{kind}: </span>{amount(item[kind], result.definition.currency)}</span></div>)}<p className="text-sm">{item.suggested >= item.current ? "Increase" : "Decrease"} by {amount(Math.abs(item.suggested - item.current), result.definition.currency)}</p>{item.reason && <p className="text-sm text-gray-600">{item.reason}</p>}</div>)}
      <div className="border-t pt-5"><h3>Evidence and limits</h3><ul className="list-disc space-y-2 pl-5">{[...result.checks, ...result.limitations].map(text => <li key={text}>{text}</li>)}</ul></div>
      <div className="flex flex-wrap gap-3 border-t pt-5">
        <button disabled={busy} onClick={() => setStep(0)}><ArrowLeft size={16} />Edit setup</button>
        {canSave && !result.plan_id && <button className={styles.primary} disabled={busy || !jobId} onClick={() => void action(async () => { const data = await request<BudgetResult>(`/jobs/${jobId}/save`, { method: "POST" }); if (mounted.current) setResult(data); await loadPlans() })}><Save size={16} />Save plan</button>}
        {result.plan_id && <span className="flex items-center gap-2 text-emerald-800"><Check size={16} />Saved</span>}
        {result.decision_id ? <Link href={`/dashboard/decisions/${result.decision_id}`}>Open decision</Link> : canDecide && result.plan_id && !decision && <button disabled={busy} onClick={() => setDecision({ title: `${result.definition.name}: allocation test`, action: "", expected_outcome: "", review_date: "" })}><Target size={16} />Create Decision</button>}
      </div>
      {decision && <form className="space-y-4 border-t pt-5" onSubmit={event => { event.preventDefault(); void action(async () => { const data = await request<{ decision_id: number }>(`/${result.plan_id}/decision`, { method: "POST", body: JSON.stringify(decision) }); if (mounted.current) { setResult({ ...result, decision_id: data.decision_id }); setDecision(null) } }) }}><h3>Create Decision</h3>
        <fieldset disabled={busy} className="space-y-4"><label>Decision name<input required maxLength={200} value={decision.title} onChange={event => setDecision({ ...decision, title: event.target.value })} /></label>
          <label>Action to take<textarea required minLength={8} maxLength={5000} value={decision.action} onChange={event => setDecision({ ...decision, action: event.target.value })} /></label>
          <label>Expected result<textarea required minLength={8} maxLength={3000} value={decision.expected_outcome} onChange={event => setDecision({ ...decision, expected_outcome: event.target.value })} /></label>
          <label>Review date<input required type="date" value={decision.review_date} onChange={event => setDecision({ ...decision, review_date: event.target.value })} /></label>
          <div className="flex gap-3"><button className={styles.primary} type="submit"><Target size={16} />Create Decision</button><button type="button" onClick={() => setDecision(null)}><X size={16} />Cancel</button></div>
        </fieldset></form>}
    </section>}
  </div>
}
