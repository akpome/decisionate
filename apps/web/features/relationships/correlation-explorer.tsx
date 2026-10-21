"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ChevronLeft, ChevronRight, Grid2X2, List, Play, RefreshCw, Save, Search, StopCircle } from "lucide-react"
import { correlationRequest } from "@/lib/api"
import { dashboardDefinitions } from "@/features/dashboards/dashboard-definitions"
import { useDecisionateText } from "@/app/use-decisionate-language"
import { RelationshipMatrix } from "./relationship-matrix"
import { RelationshipEvidence } from "./relationship-detail"
import { coefficientText, isActiveRun, metricIdentity, type CatalogDataset, type CorrelationCapabilities, type CorrelationDefinition, type CorrelationMatrix, type CorrelationRun, type MetricRef, type RelationshipCard, type RelationshipDetail } from "./types"

const inputClass = "mt-1 h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 text-sm"
const commandClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
type History = { analysis_id: string; name: string; latest_run: CorrelationRun | null }
const explainError = (value: unknown) => value instanceof Error ? value.message : "Relationship analysis is unavailable"

export function CorrelationExplorer({ userId, workspaceId }: { userId: string; workspaceId?: string }) {
  const { t } = useDecisionateText()
  const [capabilities, setCapabilities] = useState<CorrelationCapabilities | null>(null)
  const [datasets, setDatasets] = useState<CatalogDataset[]>([])
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [history, setHistory] = useState<History[]>([])
  const [selected, setSelected] = useState<MetricRef[]>([])
  const [dateColumns, setDateColumns] = useState<Record<number, string>>({})
  const [search, setSearch] = useState("")
  const [name, setName] = useState("Metric relationships")
  const [method, setMethod] = useState<"pearson" | "spearman">("spearman")
  const [grain, setGrain] = useState("daily")
  const [start, setStart] = useState(`${new Date().getUTCFullYear()}-01-01`)
  const [end, setEnd] = useState(new Date().toISOString().slice(0, 10))
  const [observations, setObservations] = useState(30)
  const [threshold, setThreshold] = useState(.3)
  const [advanced, setAdvanced] = useState(false)
  const [lag, setLag] = useState(false)
  const [maxLag, setMaxLag] = useState(14)
  const [lagDirection, setLagDirection] = useState("a_leads_b")
  const [run, setRun] = useState<CorrelationRun | null>(null)
  const [rows, setRows] = useState<RelationshipCard[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [view, setView] = useState("ranked")
  const [matrix, setMatrix] = useState<CorrelationMatrix | null>(null)
  const [detail, setDetail] = useState<RelationshipDetail | null>(null)
  const [includeInsufficient, setIncludeInsufficient] = useState(false)
  const [filterThreshold, setFilterThreshold] = useState(.3)
  const [outcomeFilter, setOutcomeFilter] = useState("")
  const [widgetType, setWidgetType] = useState("top_relationships")
  const [dashboardKey, setDashboardKey] = useState("general-business")
  const [outcome, setOutcome] = useState("")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [resultsLoading, setResultsLoading] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const submission = useRef<{ body: string; key: string } | null>(null)
  const active = isActiveRun(run)
  const pairs = selected.length * (selected.length - 1) / 2
  const datasetCount = new Set(selected.map(item => item.dataset_id)).size

  useEffect(() => {
    let current = true
    async function load() {
      try {
        const caps = await correlationRequest<CorrelationCapabilities>(userId, "/correlation-capabilities", {}, workspaceId)
        if (!current) return
        setCapabilities(caps)
        if (!caps.ui) return
        const catalogue = await correlationRequest<{ datasets: CatalogDataset[]; next_offset: number | null }>(userId, "/correlation-analyses/catalog", {}, workspaceId)
        if (!current) return
        setDatasets(catalogue.datasets)
        setNextOffset(catalogue.next_offset)
        const saved = await correlationRequest<History[]>(userId, "/correlation-analyses", {}, workspaceId)
        if (!current) return
        setHistory(saved)
        const params = new URLSearchParams(window.location.search)
        const runId = params.get("run")
        if (runId) {
          const loaded = await correlationRequest<CorrelationRun>(userId, `/correlation-runs/${encodeURIComponent(runId)}`, {}, workspaceId)
          if (!current) return
          setRun(loaded)
          setFilterThreshold(loaded.definition.filters.minimum_abs_coefficient)
          const resultId = params.get("result")
          if (resultId && loaded.status === "completed") {
            const result = await correlationRequest<RelationshipDetail>(userId, `/correlation-results/${encodeURIComponent(resultId)}`, {}, workspaceId)
            if (current && result.run_id === loaded.run_id) setDetail(result)
          }
        }
      } catch (value) { if (current) setError(explainError(value)) }
      finally { if (current) setLoading(false) }
    }
    void load()
    return () => { current = false }
  }, [userId, workspaceId])

  const runId = run?.run_id
  const runStatus = run?.status
  useEffect(() => {
    if (!runId || !["queued", "running"].includes(runStatus ?? "")) return
    let current = true, timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const status = await correlationRequest<CorrelationRun>(userId, `/correlation-runs/${runId}`, {}, workspaceId)
        if (current) setRun(status)
      } catch (value) { if (current) setError(explainError(value)) }
      if (current) timer = setTimeout(() => void poll(), 2000)
    }
    timer = setTimeout(() => void poll(), 2000)
    return () => { current = false; clearTimeout(timer) }
  }, [userId, workspaceId, runId, runStatus])

  useEffect(() => {
    if (!runId || runStatus !== "completed") return
    let current = true
    async function load() {
      setResultsLoading(true)
      try {
        if (view === "matrix") {
          const result = await correlationRequest<CorrelationMatrix>(userId, `/correlation-runs/${runId}/matrix`, {}, workspaceId)
          if (current) setMatrix(result)
        } else {
          const query = new URLSearchParams({ offset: String(offset), limit: "25", minimum_abs_coefficient: String(filterThreshold), include_insufficient: String(includeInsufficient) })
          if (outcomeFilter) query.set("outcome_metric", outcomeFilter)
          const result = await correlationRequest<{ items: RelationshipCard[]; total: number }>(userId, `/correlation-runs/${runId}/relationships?${query}`, {}, workspaceId)
          if (current) { setRows(result.items); setTotal(result.total) }
        }
      } catch (value) { if (current) setError(explainError(value)) }
      finally { if (current) setResultsLoading(false) }
    }
    void load()
    return () => { current = false }
  }, [userId, workspaceId, runId, runStatus, view, offset, filterThreshold, includeInsufficient, outcomeFilter])

  function switchRun(value: CorrelationRun) {
    setRun(value); setRows([]); setMatrix(null); setDetail(null); setOffset(0); setOutcomeFilter(""); setOutcome("")
    setFilterThreshold(value.definition.filters.minimum_abs_coefficient)
    const params = new URLSearchParams({ run: value.run_id })
    window.history.replaceState(null, "", `${window.location.pathname}?${params}`)
  }

  async function execute(action: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("")
    try { await action() } catch (value) { setError(explainError(value)) } finally { setBusy(false) }
  }

  async function submit() {
    const payload: CorrelationDefinition = { name, metrics: selected, method, grain, date_range: { start, end }, filters: { minimum_abs_coefficient: threshold, minimum_observations: observations }, lag: { enabled: lag, minimum: 0, maximum: maxLag, direction: lagDirection }, advanced }
    await execute(async () => {
      const body = JSON.stringify(payload)
      if (submission.current?.body !== body) submission.current = { body, key: crypto.randomUUID() }
      const created = await correlationRequest<CorrelationRun>(userId, "/correlation-analyses", { method: "POST", headers: { "Idempotency-Key": submission.current.key }, body }, workspaceId)
      switchRun(created)
      setHistory(current => [{ analysis_id: created.analysis_id, name, latest_run: created }, ...current.filter(item => item.analysis_id !== created.analysis_id)])
    })
  }

  async function openDetail(identity: string) {
    await execute(async () => {
      const result = await correlationRequest<RelationshipDetail>(userId, `/correlation-results/${identity}`, {}, workspaceId)
      setDetail(result)
      window.history.replaceState(null, "", `${window.location.pathname}?run=${result.run_id}&result=${result.result_id}`)
    })
  }

  async function saveWidget(type: string) {
    if (!run) return
    await execute(async () => {
      await correlationRequest(userId, "/correlation-widgets", { method: "POST", body: JSON.stringify({ analysis_id: run.analysis_id, dashboard_key: dashboardKey, widget_type: type, ...(type === "saved_relationship" ? { result_id: detail?.result_id } : {}), ...(type === "outcome_drivers" ? { outcome_metric: outcome } : {}) }) }, workspaceId)
      setMessage("Widget saved to dashboard.")
    })
  }

  async function saveInsight() {
    if (!detail) return
    await execute(async () => {
      await correlationRequest(userId, `/correlation-results/${detail.result_id}/evidence`, { method: "POST", body: JSON.stringify({ kind: "insight" }) }, workspaceId)
      setMessage("Insight saved.")
    })
  }

  if (loading) return <div className="min-w-0 space-y-6"><p role="status" className="py-8 text-sm text-gray-500">Loading relationship analysis...</p></div>
  if (!capabilities?.ui) return <div className="min-w-0 space-y-6"><h1 className="text-2xl font-semibold">{t("Compare multiple metrics")}</h1><p role="status" className="my-4 text-sm text-gray-600">{error || "Relationship analysis is not enabled for this workspace."}</p><Link href="/dashboard/relationships" className="text-sm text-blue-700 underline">{t("Compare two metrics")}</Link></div>
  const runMetrics = run?.definition.metrics ?? []
  const visibleDatasets = datasets.filter(dataset => !search || `${dataset.dataset_label} ${dataset.connector} ${dataset.metrics.map(metric => metric.label).join(" ")}`.toLowerCase().includes(search.toLowerCase()))
  return <div className="min-w-0 space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 pb-4"><h1 className="text-2xl font-semibold">{t("Compare multiple metrics")}</h1><div className="flex flex-wrap gap-x-4 gap-y-2"><Link href={run ? `/dashboard/reports?run=${run.run_id}` : "/dashboard/reports"} className="inline-flex min-h-10 items-center text-sm font-medium text-blue-700 underline">{t(run ? "Build report from results" : "Build report")}</Link><Link href="/dashboard/relationships#saved-relationships" className="inline-flex min-h-10 items-center text-sm text-blue-700 underline">{t("Saved relationships")}</Link></div></header>
    {error && <p role="alert" className="break-words rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="text-sm text-green-800">{message} <Link className="underline" href={message.startsWith("Insight") ? "/dashboard/insights" : "/dashboard"}>Open {message.startsWith("Insight") ? "insights" : "dashboard"}</Link></p>}
    <details open={!run} className="min-w-0 border-b border-gray-200 pb-5"><summary className="cursor-pointer text-base font-semibold">New analysis</summary>
      <div className="mt-4 grid min-w-0 gap-6 lg:grid-cols-2">
        <section aria-label="Select metrics" className="min-w-0">
          <label className="mb-3 flex items-center gap-2 rounded-md border px-3"><Search size={16} className="shrink-0 text-gray-400" /><input aria-label="Search metrics and datasets" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search metrics or datasets" className="h-10 min-w-0 flex-1 text-sm outline-none" /></label>
          <div className="max-h-[420px] overflow-y-auto pr-1">
            {visibleDatasets.map(dataset => <fieldset key={dataset.dataset_id} className="min-w-0 border-b border-gray-200 py-3"><legend className="break-words text-sm font-semibold">{dataset.dataset_label} <span className="text-xs font-normal text-gray-500">{dataset.connector}</span></legend>
              {dataset.date_columns.length > 0 && <label className="mb-3 block text-xs text-gray-500">Date field<select aria-label={`Date field for ${dataset.dataset_label}`} className={inputClass} value={dateColumns[dataset.dataset_id] ?? dataset.date_columns[0]} onChange={event => { const value = event.target.value; setDateColumns(current => ({ ...current, [dataset.dataset_id]: value })); setSelected(current => current.map(item => item.dataset_id === dataset.dataset_id ? { ...item, date_column: value } : item)) }}>{dataset.date_columns.map(column => <option key={column}>{column}</option>)}</select></label>}
              {dataset.metrics.length === 0 && <p className="py-2 text-xs text-gray-500">{dataset.error_code ? "Dataset temporarily unavailable." : "No configured analyzable metrics."} <Link href={`/dashboard/datasets/${dataset.dataset_id}`} className="text-blue-700 underline">Dataset settings</Link></p>}
              {dataset.metrics.map(metric => {
                const identity = metricIdentity(metric), checked = selected.some(item => metricIdentity(item) === identity)
                const dateField = dateColumns[dataset.dataset_id] ?? dataset.date_columns[0]
                const availability = dataset.availability[dateField]
                return <label key={identity} className="flex min-w-0 items-start gap-3 py-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-blue-600" checked={checked} disabled={!dateField || active || busy || !checked && selected.length >= (advanced ? 50 : 25)} onChange={event => setSelected(current => event.target.checked ? [...current, { dataset_id: metric.dataset_id, metric_key: metric.metric_key, date_column: dateField, aggregation: metric.aggregation }] : current.filter(item => metricIdentity(item) !== identity))} /><span className="min-w-0"><span className="block break-words font-medium">{metric.label}</span><span className="block break-words text-xs leading-5 text-gray-500">{metric.currency ?? metric.unit} / {metric.aggregation === "policy" ? "Saved aggregation policy" : metric.aggregation} / {availability ? `${availability.start} to ${availability.end}` : "No dated observations"}</span><span className="block break-words text-xs leading-5 text-gray-500">{metric.definition}</span>{(metric.constant || metric.missing_fraction > 0 || metric.currency_unresolved || metric.components.length > 0) && <span className="block text-xs leading-5 text-amber-800">{[metric.constant && "Constant series", metric.missing_fraction > 0 && `${Math.round(metric.missing_fraction * 100)}% missing`, metric.currency_unresolved && "Currency unspecified", metric.components.length > 0 && `Derived from ${metric.components.join(", ")}`].filter(Boolean).join(" / ")}</span>}</span></label>
              })}
            </fieldset>)}
          </div>
          {nextOffset !== null && <button type="button" className={`${commandClass} mt-3`} disabled={busy} onClick={() => void execute(async () => { const page = await correlationRequest<{ datasets: CatalogDataset[]; next_offset: number | null }>(userId, `/correlation-analyses/catalog?offset=${nextOffset}`, {}, workspaceId); setDatasets(current => [...current, ...page.datasets]); setNextOffset(page.next_offset) })}>Load more datasets</button>}
        </section>
        <form className="min-w-0 space-y-4" onSubmit={event => { event.preventDefault(); void submit() }}>
          <label className="block text-xs text-gray-600">Analysis name<input required maxLength={120} value={name} onChange={event => setName(event.target.value)} className={inputClass} /></label>
          <div className="grid grid-cols-2 gap-3"><label className="block text-xs text-gray-600">Method<select value={method} onChange={event => setMethod(event.target.value as typeof method)} className={inputClass}><option value="spearman">Spearman</option><option value="pearson">Pearson</option></select></label><label className="block text-xs text-gray-600">Period<select value={grain} onChange={event => setGrain(event.target.value)} className={inputClass}>{["daily", "weekly", "monthly", "quarterly"].map(value => <option key={value}>{value}</option>)}</select></label></div>
          <div className="grid grid-cols-2 gap-3"><label className="block text-xs text-gray-600">Start<input type="date" required value={start} max={end} onChange={event => setStart(event.target.value)} className={inputClass} /></label><label className="block text-xs text-gray-600">End<input type="date" required value={end} min={start} onChange={event => setEnd(event.target.value)} className={inputClass} /></label></div>
          <div className="grid grid-cols-2 gap-3"><label className="block text-xs text-gray-600">Minimum observations<input type="number" required min={2} max={3653} value={observations} onChange={event => setObservations(Number(event.target.value))} className={inputClass} /></label><label className="block text-xs text-gray-600">Minimum |coefficient|<input type="number" required min={0} max={1} step={.05} value={threshold} onChange={event => setThreshold(Number(event.target.value))} className={inputClass} /></label></div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={advanced} onChange={event => setAdvanced(event.target.checked)} className="mt-1 h-4 w-4" />Advanced selection (up to 50 metrics)</label>
          {capabilities.lag && <><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={lag} onChange={event => setLag(event.target.checked)} className="h-4 w-4" />Evaluate lagged relationships</label>{lag && <div className="grid grid-cols-2 gap-3"><label className="block text-xs text-gray-600">Maximum shared periods<input type="number" min={0} max={14} value={maxLag} onChange={event => setMaxLag(Number(event.target.value))} className={inputClass} /></label><label className="block text-xs text-gray-600">Lead metric<select className={inputClass} value={lagDirection} onChange={event => setLagDirection(event.target.value)}><option value="a_leads_b">Canonical metric A</option><option value="b_leads_a">Canonical metric B</option></select></label></div>}</>}
          <p className="text-sm font-medium">{selected.length} metrics / {datasetCount} datasets / {pairs} relationships</p>
          {selected.length > 10 && <p className="text-xs text-amber-800">Large comparison family. Interpret results as exploratory.</p>}
          <button type="submit" className={`${commandClass} border-blue-600 bg-blue-600 text-white`} disabled={busy || active || datasetCount < 2 || selected.length < 2 || selected.length > (advanced ? 50 : 25)}><Play size={16} />Run analysis</button>
        </form>
      </div>
    </details>
    {history.length > 0 && <label className="block max-w-lg text-xs text-gray-600">Saved analyses<select aria-label="Saved analyses" className={inputClass} value={run?.analysis_id ?? ""} onChange={event => { const selectedRun = history.find(item => item.analysis_id === event.target.value)?.latest_run; if (selectedRun) switchRun(selectedRun) }}><option value="">Choose an analysis</option>{history.map(item => <option key={item.analysis_id} value={item.analysis_id}>{item.name} / {run?.analysis_id === item.analysis_id ? run.status : item.latest_run?.status}</option>)}</select></label>}
    {run && <section aria-label="Analysis run" className="min-w-0 space-y-4 border-t border-gray-200 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><h2 className="break-words text-lg font-semibold">{run.definition.name}</h2><p role="status" className="text-sm text-gray-500">{run.progress.phase} / {run.progress.completed_pairs} of {run.progress.total_pairs} pairs{run.error_code ? ` / ${run.error_code.replaceAll("_", " ")}` : ""}</p></div><div className="flex gap-2">{active ? <button type="button" disabled={busy} className={commandClass} onClick={() => void execute(async () => { const value = await correlationRequest<CorrelationRun>(userId, `/correlation-runs/${run.run_id}/cancel`, { method: "POST" }, workspaceId); setRun(value) })}><StopCircle size={16} />Cancel</button> : <button type="button" disabled={busy} className={commandClass} onClick={() => void execute(async () => { const value = await correlationRequest<CorrelationRun>(userId, `/correlation-analyses/${run.analysis_id}/runs`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() } }, workspaceId); switchRun(value) })}><RefreshCw size={16} />Recalculate</button>}</div></div>
      {active && <progress aria-label="Relationship calculation progress" max={Math.max(1, run.progress.total_pairs)} value={run.progress.completed_pairs} className="h-2 w-full accent-blue-600" />}
      {run.status === "completed" && <>
        <div className="flex flex-wrap items-center gap-3"><div role="group" aria-label="Results view" className="flex rounded-md border p-1">{[["ranked", "Ranked", List], ["matrix", "Matrix", Grid2X2]].map(([value, label, Icon]) => { const Glyph = Icon as typeof List; return <button key={String(value)} type="button" aria-pressed={view === value} onClick={() => setView(String(value))} className={`inline-flex h-9 items-center gap-2 rounded px-3 text-sm ${view === value ? "bg-gray-100 font-semibold" : ""}`}><Glyph size={16} />{String(label)}</button> })}</div><p className="text-xs text-gray-500">{run.definition.method} / {run.definition.grain} / {run.definition.date_range.start} to {run.definition.date_range.end}</p></div>
        {view === "ranked" && <><div className="flex flex-wrap items-end gap-4"><label className="block w-36 text-xs text-gray-500">Minimum |coefficient|<input type="number" min={run.definition.filters.minimum_abs_coefficient} max={1} step={.05} className={inputClass} value={filterThreshold} onChange={event => { setOffset(0); setFilterThreshold(Number(event.target.value)) }} /></label><label className="block max-w-full text-xs text-gray-500">Outcome<select className={inputClass} value={outcomeFilter} onChange={event => { setOffset(0); setOutcomeFilter(event.target.value) }}><option value="">All metrics</option>{runMetrics.map(metric => <option key={metricIdentity(metric)} value={metricIdentity(metric)}>{metric.metric_key} / dataset {metric.dataset_id}</option>)}</select></label><label className="mb-2 flex gap-2 text-sm"><input type="checkbox" checked={includeInsufficient} onChange={event => { setOffset(0); setIncludeInsufficient(event.target.checked) }} className="h-4 w-4" />Include insufficient results</label></div>
          <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr>{["Metric A / source", "Metric B / source", "Coefficient", "Lag", "n", "Reliability", ""].map((value, index) => <th key={index} className="whitespace-nowrap border-b px-3 py-3 text-xs font-medium text-gray-500">{value}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.result_id} className="border-b border-gray-100"><td className="min-w-36 px-3 py-3"><span className="block font-medium">{row.metric_a.label}</span><span className="text-xs text-gray-500">{row.metric_a.dataset_label} / {row.metric_a.currency ?? row.metric_a.unit}</span></td><td className="min-w-36 px-3 py-3"><span className="block font-medium">{row.metric_b.label}</span><span className="text-xs text-gray-500">{row.metric_b.dataset_label} / {row.metric_b.currency ?? row.metric_b.unit}</span></td><td className="px-3 py-3 font-medium tabular-nums">{coefficientText(row.coefficient)}</td><td className="px-3 py-3">{row.lag.periods}</td><td className="px-3 py-3">{row.observations}</td><td className="px-3 py-3">{row.reliability}</td><td className="px-3 py-3"><button type="button" className="text-blue-700 underline" disabled={busy} onClick={() => void openDetail(row.result_id)}>Evidence</button></td></tr>)}</tbody></table></div>
          {resultsLoading ? <p role="status" className="text-sm text-gray-500">Loading relationships...</p> : rows.length === 0 && <p className="py-4 text-sm text-gray-500">No relationships match these filters.</p>}
          <div className="flex items-center justify-between gap-3 text-xs text-gray-500"><span>{total} relationships</span><div className="flex gap-2"><button aria-label="Previous relationships" title="Previous relationships" type="button" className={commandClass} disabled={offset === 0 || resultsLoading} onClick={() => setOffset(value => Math.max(0, value - 25))}><ChevronLeft size={16} /></button><button aria-label="Next relationships" title="Next relationships" type="button" className={commandClass} disabled={offset + 25 >= total || resultsLoading} onClick={() => setOffset(value => value + 25)}><ChevronRight size={16} /></button></div></div>
        </>}
        {view === "matrix" && (matrix ? <RelationshipMatrix matrix={matrix} onSelect={identity => void openDetail(identity)} /> : <p role="status" className="text-sm text-gray-500">Loading matrix...</p>)}
        {capabilities.widgets && <div className="flex flex-wrap items-end gap-3 border-t border-gray-200 pt-4"><label className="block max-w-full text-xs text-gray-500">Dashboard<select className={inputClass} value={dashboardKey} onChange={event => setDashboardKey(event.target.value)}>{dashboardDefinitions.map(dashboard => <option key={dashboard.key} value={dashboard.key}>{dashboard.name}</option>)}</select></label><label className="block max-w-full text-xs text-gray-500">Widget<select className={inputClass} value={widgetType} onChange={event => setWidgetType(event.target.value)}><option value="top_relationships">Top Relationships</option><option value="outcome_drivers">Outcome Associations</option></select></label>{widgetType === "outcome_drivers" && <label className="block max-w-full text-xs text-gray-500">Outcome metric<select className={inputClass} value={outcome} onChange={event => setOutcome(event.target.value)}><option value="">Choose outcome</option>{runMetrics.map(metric => <option key={metricIdentity(metric)} value={metricIdentity(metric)}>{metric.metric_key} / dataset {metric.dataset_id}</option>)}</select></label>}<button type="button" disabled={busy || widgetType === "outcome_drivers" && !outcome} onClick={() => void saveWidget(widgetType)} className={commandClass}><Save size={16} />Save widget</button></div>}
        <p className="text-xs leading-5 text-gray-500">Association does not establish causation. Lag counts shared reporting periods. Significance is unavailable when the statistical backend does not provide p-values.</p>
      </>}
    </section>}
    {detail && <RelationshipEvidence detail={detail} busy={busy} canPin={capabilities.widgets} onClose={() => { setDetail(null); window.history.replaceState(null, "", `${window.location.pathname}?run=${runId}`) }} onPin={() => void saveWidget("saved_relationship")} onInsight={() => void saveInsight()} />}
  </div>
}
