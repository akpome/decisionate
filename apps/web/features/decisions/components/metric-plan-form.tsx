"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { correlationRequest, createDecision, type DecisionCreatePayload, type DecisionRecord } from "@/lib/api"
import { metricIdentity, type CatalogDataset, type CatalogMetric } from "@/features/relationships/types"
import type { BusinessReport } from "@/features/reports/types"
import { decisionCreationKey } from "../lib/creation-request"
import { MetricReviewSummary, roles, type MetricReview, type Role } from "./metric-review"

const field = "mt-1 block h-10 w-full min-w-0 rounded-md border bg-white px-2 text-sm"
type Target = {metric: string; direction: "increase" | "decrease"; unit: "percent" | "amount"; change: string}
type Preview = {review: MetricReview; previous: {id: number; title: string; summary: string} | null}
type Dataset = {id: number; file_name: string; source_type?: string | null}
function day(offset: number) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-")
}
function metricTarget(metric = ""): Target { return {metric, direction: "increase", unit: "percent", change: ""} }

export function MetricPlanForm({userId, workspace, datasets, report, reportId, initialDataset, initialMetric, findingId, lockedOutcome, onCreated}: {
  userId: string; workspace?: string; datasets: Dataset[]; report: BusinessReport | null; reportId: string
  initialDataset?: number | null; initialMetric?: string; findingId?: string; lockedOutcome?: string
  onCreated?: (decision: DecisionRecord) => void
}) {
  const router = useRouter()
  const metrics = report?.metrics.filter(m => m.value !== null) ?? []
  const finding = report?.findings.find(f => f.eligible && report.included_findings.includes(f.id) &&
    [f.metric_a.id, f.metric_b.id].every(id => metrics.some(m => m.id === id)) &&
    [f.metric_a.id, f.metric_b.id].includes(f.lead_metric) && (!lockedOutcome ||
    [f.metric_a.id, f.metric_b.id].includes(lockedOutcome) && f.lead_metric !== lockedOutcome))
  const initialInput = finding?.lead_metric || metrics.find(m => m.id !== lockedOutcome)?.id
  const initialOutput = lockedOutcome || (finding && [finding.metric_a.id, finding.metric_b.id].find(id => id !== initialInput)) || metrics.find(m => m.id !== initialInput)?.id
  const [targets, setTargets] = useState({input: metricTarget(initialInput), output: metricTarget(initialOutput ||
    (!reportId && initialDataset && initialMetric ? metricIdentity({dataset_id: initialDataset, metric_key: initialMetric}) : ""))})
  const [source, setSource] = useState({input: String(initialDataset || ""), output: String(initialDataset || "")})
  const [catalogs, setCatalogs] = useState<Record<string, CatalogMetric[]>>({})
  const [catalogError, setCatalogError] = useState("")
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (reportId) return
    const controller = new AbortController()
    async function load() {
      try {
        setCatalogError("")
        const entries = await Promise.all([...new Set(Object.values(source).filter(Boolean))].map(async id => {
          const page = await correlationRequest<{datasets: CatalogDataset[]}>(userId, "/business-reports/catalog?dataset_id=" + id,
            {signal: controller.signal}, workspace)
          return [id, page.datasets[0]?.metrics || []] as const
        }))
        if (!controller.signal.aborted) setCatalogs(Object.fromEntries(entries))
      } catch { if (!controller.signal.aborted) setCatalogError("The dataset metrics could not be loaded.") }
    }
    void load()
    return () => controller.abort()
  }, [source, userId, workspace, reportId, retry])
  const [start, setStart] = useState(() => day(0)), [review, setReview] = useState(() => day(14))
  const [customTitle, setCustomTitle] = useState("")
  const [preview, setPreview] = useState<Preview | null>(null), [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const choices = (role: Role) => reportId ? metrics : catalogs[source[role]] || []
  const selected = (role: Role) => choices(role).find(m => metricIdentity(m) === targets[role].metric)
  const phrase = (role: Role) => {
    const t = targets[role]
    return (t.direction === "increase" ? "Increase " : "Decrease ") + (selected(role)?.label || "metric") + " by " + t.change + (t.unit === "percent" ? "%" : "")
  }
  const generatedTitle = phrase("input") + "; " + phrase("output").toLowerCase()
  function change(role: Role, next: Partial<Target>) { setTargets(old => ({...old, [role]: {...old[role], ...next}})) }
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (lock.current || !selected("input") || !selected("output")) return
    lock.current = true; setBusy(true); setError("")
    try {
      const target = (r: Role) => ({dataset_id: selected(r)!.dataset_id, metric_key: selected(r)!.metric_key,
        direction: targets[r].direction, unit: targets[r].unit, change: Number(targets[r].change)})
      const plan = {start, review, input: target("input"), output: target("output"), report_id: reportId || null}
      if (!preview) {
        setPreview(await correlationRequest<Preview>(userId, "/business-reports/metric-plans/preview",
          {method: "POST", body: JSON.stringify(plan)}, workspace))
        return
      }
      const title = (customTitle.trim() || generatedTitle).slice(0, 200)
      const action = phrase("input"), expected = phrase("output")
      let base: DecisionCreatePayload = {title, action, expected_outcome: expected, dataset_id: plan.output.dataset_id,
        outcome_dataset_id: plan.output.dataset_id, metric_column: plan.output.metric_key, review_date: review + "T00:00:00",
        evidence_dataset_ids: [...new Set(roles.map(r => plan[r].dataset_id))]}
      if (reportId) {
        const result = await correlationRequest<{decision_payload: DecisionCreatePayload}>(userId, "/business-reports/" + encodeURIComponent(reportId) + "/decision-evidence",
          {method: "POST", body: JSON.stringify({title, action, expected_outcome: expected, reasoning: (report!.business_question || "").trim().length >= 3 ? report!.business_question : action + "; " + expected,
            outcome_metric: targets.output.metric, review_date: review, ...(findingId ? {finding_id: findingId} : {})})}, workspace)
        base = result.decision_payload
      }
      const payload = {...base, metric_plan: plan}
      const saved = await createDecision(payload, userId, workspace, await decisionCreationKey(JSON.stringify([userId, workspace, payload])))
      if (onCreated) onCreated(saved)
      else router.replace("/decisions/" + saved.id)
    } catch (err) { setError(err instanceof Error ? err.message : "Could not check the plan. Try again.") }
    finally { lock.current = false; setBusy(false) }
  }
  return <form onSubmit={submit} onChange={() => {setPreview(null); setError("")}} className="mt-4 space-y-5">
    <fieldset disabled={busy} className="space-y-5">
      {roles.map(role => <fieldset key={role} className="border-t pt-3">
        <legend className="pr-2 font-semibold">{role === "input" ? "What will you change?" : "What result do you want?"}</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {!reportId && <label className="text-sm">Dataset<select className={field} required value={source[role]} onChange={e => {
            setSource({...source, [role]: e.target.value}); change(role, {metric: ""})
          }}><option value="">Choose dataset</option>{datasets.filter(d => d.source_type !== "joined").map(d => <option key={d.id} value={d.id}>{d.file_name}</option>)}</select></label>}
          <label className="text-sm">Metric<select className={field} required value={targets[role].metric} disabled={role === "output" && !!lockedOutcome} onChange={e => change(role, {metric: e.target.value})}>
            <option value="">Choose metric</option>{choices(role).map(m => <option key={metricIdentity(m)} value={metricIdentity(m)}>{reportId && "dataset_label" in m ? String(m.dataset_label) + " / " : ""}{m.label}</option>)}
          </select></label>
          <label className="text-sm">Direction<select className={field} value={targets[role].direction} onChange={e => change(role, {direction: e.target.value as Target["direction"]})}><option value="increase">Increase</option><option value="decrease">Decrease</option></select></label>
          <label className="text-sm">Change by<select className={field} value={targets[role].unit} onChange={e => change(role, {unit: e.target.value as Target["unit"]})}><option value="percent">Percentage</option><option value="amount">Amount</option></select></label>
          <label className="text-sm">{targets[role].unit === "percent" ? "At least (%)" : "At least (" + (selected(role)?.currency || selected(role)?.unit || "units") + ")"}<input className={field} type="number" min="0.00000001" max="1000000000000000" step="any" required value={targets[role].change} onChange={e => change(role, {change: e.target.value})}/></label>
        </div></fieldset>)}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Change starts<input className={field} required type="date" value={start} onChange={e => setStart(e.target.value)}/></label>
        <label className="text-sm">Review on<input className={field} required type="date" min={start} value={review} onChange={e => setReview(e.target.value)}/></label>
      </div>
      {selected("input") && selected("output") && targets.input.change && targets.output.change && <label className="block text-sm">Decision name<input className={field} maxLength={200} value={customTitle || generatedTitle} onChange={e => setCustomTitle(e.target.value)}/></label>}
      {catalogError && <p role="alert">{catalogError} <button type="button" onClick={() => setRetry(retry + 1)}>Retry</button></p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {preview && <><MetricReviewSummary review={preview.review}/>{preview.previous && <p className="text-sm">Last comparable decision: <Link className="text-blue-700 underline" href={"/decisions/" + preview.previous.id}>{preview.previous.title}</Link>. {preview.previous.summary}</p>}</>}
      <button disabled={busy || !selected("input") || !selected("output")} className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? "Checking..." : preview ? "Create decision" : "Preview targets"}</button>
    </fieldset>
  </form>
}
