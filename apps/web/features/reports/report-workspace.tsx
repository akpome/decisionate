"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CalendarDays, ChartNoAxesCombined, FileText, LoaderCircle, Play, Printer, RefreshCw, Save, Search } from "lucide-react"
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { correlationRequest, getMyOrganization, getOrganizationWorkspaces } from "@/lib/api"
import { defaultWorkspaceBrand, getWorkspaceBrand, type WorkspaceBrand } from "@/lib/workspace-brand"
import { WorkspaceBrandMark } from "@/app/dashboard/workspace-brand-mark"
import { useDecisionateText } from "@/app/use-decisionate-language"
import { metricIdentity, type CatalogDataset } from "@/features/relationships/types"
import { AnalysisNavigation } from "./analysis-navigation"
import { editableDefinition, formatReportValue, type BusinessReport, type ReportDefinition, type ReportFinding } from "./types"

const input = "mt-1 min-h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-950"
const command = "inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
const button = `${command} border-gray-300 bg-white`
const primaryButton = `${command} border-blue-700 bg-blue-700 text-white`
type SavedReport = { report_id: string; name: string; created_at: string }
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Report unavailable. Your selections have been preserved."

const mergeCatalog = (current: CatalogDataset[], added: CatalogDataset[]) => [...new Map([...current, ...added].map(item => [item.dataset_id, item])).values()]

async function hydrateCatalog(userId: string, workspaceId: string | undefined, current: CatalogDataset[], value: ReportDefinition) {
  let result = current
  for (const identity of new Set(value.metrics.map(metric => metric.dataset_id))) {
    if (result.some(dataset => dataset.dataset_id === identity)) continue
    const page = await correlationRequest<{ datasets: CatalogDataset[] }>(userId, `/business-reports/catalog?dataset_id=${identity}`, {}, workspaceId)
    result = mergeCatalog(result, page.datasets)
  }
  return result
}

export function ReportWorkspace({ userId, workspaceId, canManage, canSave }: {
  userId: string; workspaceId?: string; canManage: boolean; canSave: boolean
}) {
  const { t } = useDecisionateText()
  const [datasets, setDatasets] = useState<CatalogDataset[]>([])
  const [dateColumns, setDateColumns] = useState<Record<number, string>>({})
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [saved, setSaved] = useState<SavedReport[]>([])
  const [definition, setDefinition] = useState<ReportDefinition>(() => editableDefinition({}))
  const [report, setReport] = useState<BusinessReport | null>(null)
  const [view, setView] = useState<"explore" | "report">("explore")
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [brand, setBrand] = useState<WorkspaceBrand>(defaultWorkspaceBrand)
  const request = <T,>(path: string, init: RequestInit = {}) => correlationRequest<T>(userId, `/business-reports${path}`, init, workspaceId)
  const selectedIds = definition.included_findings ?? []
  const datasetCount = new Set(definition.metrics.map(metric => metric.dataset_id)).size
  const pairCount = definition.metrics.reduce((count, metric, index) => count + definition.metrics.slice(index + 1).filter(other => other.dataset_id !== metric.dataset_id).length, 0)
  const taskCount = pairCount * (definition.lag.enabled ? definition.lag.maximum + 1 : 1)

  useEffect(() => {
    let current = true
    async function load() {
      try {
        const catalog = await correlationRequest<{ datasets: CatalogDataset[]; next_offset: number | null }>(userId, "/business-reports/catalog", {}, workspaceId)
        if (!current) return
        setDatasets(catalog.datasets); setNextOffset(catalog.next_offset)
        const history = await correlationRequest<SavedReport[]>(userId, "/business-reports", {}, workspaceId)
        if (!current) return
        setSaved(history)
        const params = new URLSearchParams(window.location.search)
        if (params.get("report")) {
          const result = await correlationRequest<BusinessReport>(userId, `/business-reports/${encodeURIComponent(params.get("report")!)}`, {}, workspaceId)
          if (!current) return
          setReport(result); setDefinition(editableDefinition(result.definition)); setView("report")
          const hydrated = await hydrateCatalog(userId, workspaceId, catalog.datasets, result.definition)
          if (current) setDatasets(hydrated)
        } else if (params.get("weekly")) {
          const result = await correlationRequest<BusinessReport>(userId, "/business-reports/weekly-preview", {}, workspaceId)
          if (!current) return
          setReport(result); setDefinition(editableDefinition(result.definition)); setView("report")
          const hydrated = await hydrateCatalog(userId, workspaceId, catalog.datasets, result.definition)
          if (current) setDatasets(hydrated)
        } else if (params.get("run")) {
          const result = await correlationRequest<ReportDefinition>(userId, `/business-reports/from-run/${encodeURIComponent(params.get("run")!)}`, {}, workspaceId)
          if (!current) return
          setDefinition(editableDefinition(result))
          const hydrated = await hydrateCatalog(userId, workspaceId, catalog.datasets, result)
          if (current) setDatasets(hydrated)
        } else if (params.get("dataset")) {
          const identity = Number(params.get("dataset"))
          if (Number.isSafeInteger(identity) && identity > 0) {
            const selectedDataset = await correlationRequest<{ datasets: CatalogDataset[] }>(userId, `/business-reports/catalog?dataset_id=${identity}`, {}, workspaceId)
            if (!current) return
            setDatasets(mergeCatalog(catalog.datasets, selectedDataset.datasets))
            const dataset = selectedDataset.datasets[0]
            const metric = dataset?.metrics.find(item => item.metric_key === params.get("metric")) || dataset?.metrics[0]
            const dateColumn = dataset?.date_columns[0]
            if (metric && dateColumn) {
              setDefinition(editableDefinition({ metrics: [{ dataset_id: identity, metric_key: metric.metric_key, date_column: dateColumn, aggregation: metric.aggregation }], date_range: dataset.availability[dateColumn] }))
            }
          }
        }
      } catch (value) { if (current) setError(errorMessage(value)) }
      finally { if (current) setLoading(false) }
      try {
        const organization = await getMyOrganization(userId)
        const workspaces = await getOrganizationWorkspaces(userId)
        if (current) setBrand(getWorkspaceBrand(workspaceId || userId, userId, organization, workspaces, undefined))
      } catch { /* Optional branding must not prevent analysis. */ }
    }
    void load()
    return () => { current = false }
  }, [userId, workspaceId])

  function edit(patch: Partial<ReportDefinition>) {
    setDefinition(current => ({ ...current, ...patch, included_findings: [] }))
    setReport(null); setError(""); setMessage("")
  }

  function toggleMetric(dataset: CatalogDataset, key: string) {
    const metric = dataset.metrics.find(item => item.metric_key === key)!
    const existing = definition.metrics.find(item => item.dataset_id === dataset.dataset_id && item.metric_key === key)
    const dateColumn = dateColumns[dataset.dataset_id] || definition.metrics.find(item => item.dataset_id === dataset.dataset_id)?.date_column || dataset.date_columns[0]
    const metrics = existing ? definition.metrics.filter(item => item !== existing) : [...definition.metrics, {
      dataset_id: dataset.dataset_id, metric_key: key, date_column: dateColumn, aggregation: metric.aggregation,
    }]
    const availability = dataset.availability[dateColumn]
    let range = definition.date_range
    if (!range.end && availability) {
      const start = new Date(`${availability.end}T00:00:00Z`)
      start.setUTCDate(start.getUTCDate() - 29)
      range = { start: availability.start > start.toISOString().slice(0, 10) ? availability.start : start.toISOString().slice(0, 10), end: availability.end }
    }
    edit({ metrics, date_range: range })
  }

  async function execute(action: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("")
    try { await action() } catch (value) { setError(errorMessage(value)) } finally { setBusy(false) }
  }

  async function calculate() {
    await execute(async () => {
      const result = await request<BusinessReport>("/preview", { method: "POST", body: JSON.stringify(definition) })
      setReport(result)
      setView("report")
    })
  }

  async function saveSnapshot() {
    if (report?.report_id) return report
    const result = await request<BusinessReport>("", { method: "POST", body: JSON.stringify(definition) })
    setReport(result)
    setSaved(current => [{ report_id: result.report_id!, name: result.name, created_at: result.generated_at }, ...current])
    window.history.replaceState(null, "", `/dashboard/reports?report=${result.report_id}`)
    return result
  }

  function chooseFinding(id: string, checked: boolean) {
    setDefinition(current => ({ ...current, included_findings: checked ? [...(current.included_findings || []), id] : (current.included_findings || []).filter(value => value !== id) }))
    setReport(current => current ? { ...current, report_id: undefined } : null)
  }

  if (loading) return <div className="mx-auto min-w-0 max-w-[1500px] space-y-5"><AnalysisNavigation active="reports" /><p role="status" className="py-8 text-sm text-gray-600">Loading cross-dataset reports...</p></div>
  return <div className="mx-auto min-w-0 max-w-[1500px] space-y-5">
    <AnalysisNavigation active="reports" />
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-4 print:hidden">
      <h1 className="text-2xl font-semibold">Reports</h1>
      <div role="tablist" aria-label="Report workspace" className="flex w-full min-w-0 gap-1 rounded-md border border-gray-200 bg-white p-1 sm:w-auto">
        {(["explore", "report"] as const).map(mode => <button key={mode} type="button" role="tab" tabIndex={view === mode ? 0 : -1} aria-selected={view === mode} aria-controls={`report-${mode}`} id={`tab-${mode}`} onClick={() => setView(mode)} onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
          event.preventDefault()
          const next = event.key === "Home" ? "explore" : event.key === "End" ? "report" : mode === "explore" ? "report" : "explore"
          setView(next); document.getElementById(`tab-${next}`)?.focus()
        }} className={`inline-flex min-h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded px-3 text-sm sm:flex-none ${view === mode ? "bg-blue-50 font-semibold text-blue-800" : "text-gray-600"}`}>{mode === "explore" ? <ChartNoAxesCombined size={16} aria-hidden="true" className="shrink-0" /> : <FileText size={16} aria-hidden="true" className="shrink-0" />}<span className="min-w-0 break-words">{t(mode === "explore" ? "Build report" : "Report preview")}</span></button>)}
      </div>
    </header>
    {error && <p role="alert" className="break-words rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="text-sm text-green-800">{message}</p>}
    <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
      <label className="block w-full max-w-md text-xs text-gray-600">Saved reports<select className={input} disabled={busy} value={report?.report_id || ""} onChange={event => {
        const id = event.target.value
        if (!id) return
        void execute(async () => { const result = await request<BusinessReport>(`/${id}`); setReport(result); setDefinition(editableDefinition(result.definition)); setDateColumns({}); setDatasets(await hydrateCatalog(userId, workspaceId, datasets, result.definition)); setView("report"); window.history.replaceState(null, "", `/dashboard/reports?report=${id}`) })
      }}><option value="">Unsaved analysis</option>{saved.map(item => <option key={item.report_id} value={item.report_id}>{item.name} / {item.created_at.slice(0, 10)}</option>)}</select></label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={busy} title="Refresh available datasets" aria-label="Refresh available datasets" onClick={() => void execute(async () => { const result = await request<{ datasets: CatalogDataset[]; next_offset: number | null }>("/catalog"); setDatasets(await hydrateCatalog(userId, workspaceId, result.datasets, definition)); setNextOffset(result.next_offset) })}><RefreshCw size={16} /></button>
        {report && <>
          <button type="button" className={button} disabled={busy || !canSave || Boolean(report.report_id)} onClick={() => void execute(async () => { await saveSnapshot(); setMessage("Report snapshot saved.") })}><Save size={16} />Save snapshot</button>
          <button type="button" className={button} disabled={busy || !canManage} onClick={() => void execute(async () => { const value = await saveSnapshot(); await request(`/${value.report_id}/weekly`, { method: "POST" }); setMessage("Weekly report template saved. Existing recipients and sending preferences are unchanged.") })}><CalendarDays size={16} />Use for weekly report</button>
          {view === "report" && <button type="button" className={button} title="Print or save as PDF" aria-label="Print or save as PDF" onClick={() => window.print()}><Printer size={17} /></button>}
        </>}
        <Link href="/dashboard/alerts" className={button}><CalendarDays size={16} />Weekly delivery</Link>
      </div>
    </div>

    <section role="tabpanel" id="report-explore" aria-labelledby="tab-explore" hidden={view !== "explore"} className="space-y-6 print:hidden">
      <form onSubmit={event => { event.preventDefault(); void calculate() }}>
        <fieldset disabled={busy} className="min-w-0 space-y-5">
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <label className="block text-xs font-medium text-gray-700">Report name<input className={input} required maxLength={120} value={definition.name} onChange={event => edit({ name: event.target.value })} /></label>
            <label className="block text-xs font-medium text-gray-700">Business question<input className={input} required minLength={8} maxLength={1000} value={definition.business_question} onChange={event => edit({ business_question: event.target.value })} /></label>
          </div>
          <div className="grid min-w-0 gap-6 border-y border-gray-200 py-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section aria-label="Datasets and metrics" className="min-w-0">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">Datasets and metrics</h2><label className="relative block w-full max-w-xs"><Search size={15} className="absolute left-3 top-3 text-gray-400" /><input aria-label="Search datasets and metrics" className={`${input} mt-0 pl-9`} type="search" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
              <div className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
                {datasets.filter(dataset => `${dataset.dataset_label} ${dataset.metrics.map(item => item.label).join(" ")}`.toLowerCase().includes(search.toLowerCase())).map(dataset => <fieldset key={dataset.dataset_id} className="min-w-0 border-b border-gray-100 py-3">
                  <legend className="max-w-full break-words text-sm font-semibold">{dataset.dataset_label} <span className="font-normal text-gray-500">/ {dataset.connector}</span></legend>
                  {dataset.date_columns.length > 0 && <label className="mt-2 block max-w-sm text-xs text-gray-500">Date column<select className={input} value={dateColumns[dataset.dataset_id] || definition.metrics.find(item => item.dataset_id === dataset.dataset_id)?.date_column || dataset.date_columns[0]} onChange={event => { setDateColumns(current => ({ ...current, [dataset.dataset_id]: event.target.value })); edit({ metrics: definition.metrics.map(item => item.dataset_id === dataset.dataset_id ? { ...item, date_column: event.target.value } : item) }) }}>{dataset.date_columns.map(column => <option key={column}>{column}</option>)}</select></label>}
                  {dataset.error_code && <p className="py-2 text-sm text-amber-800">Dataset unavailable</p>}
                  {!dataset.error_code && dataset.metrics.length === 0 && <Link href={`/dashboard/datasets/${dataset.dataset_id}`} className="inline-block py-2 text-sm text-blue-700 underline">Review dataset metric selection</Link>}
                  <div className="mt-2 grid min-w-0 gap-x-4 gap-y-2 sm:grid-cols-2">{dataset.metrics.map(metric => <label key={metric.metric_key} className="flex min-w-0 items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" disabled={!dataset.date_columns.length || definition.metrics.length >= 25 && !definition.metrics.some(item => metricIdentity(item) === metricIdentity(metric))} checked={definition.metrics.some(item => metricIdentity(item) === metricIdentity(metric))} onChange={() => toggleMetric(dataset, metric.metric_key)} /><span className="min-w-0 break-words">{metric.label}<span className="block text-xs text-gray-500">{metric.currency || metric.unit} / {metric.aggregation}</span></span></label>)}</div>
                </fieldset>)}
              </div>
              {nextOffset !== null && <button type="button" className={`${button} mt-3`} onClick={() => void execute(async () => { const result = await request<{ datasets: CatalogDataset[]; next_offset: number | null }>(`/catalog?offset=${nextOffset}`); setDatasets(current => mergeCatalog(current, result.datasets)); setNextOffset(result.next_offset) })}>Load more datasets</button>}
              {datasets.length === 0 && <Link href="/dashboard/datasets" className="text-sm text-blue-700 underline">Open datasets</Link>}
            </section>
            <section className="min-w-0 space-y-4" aria-label="Analysis settings">
              <h2 className="text-base font-semibold">Analysis settings</h2>
              <div className="grid grid-cols-2 gap-3"><label className="block text-xs text-gray-600">Start<input className={input} type="date" required max={definition.date_range.end || undefined} value={definition.date_range.start} onChange={event => edit({ date_range: { ...definition.date_range, start: event.target.value } })} /></label><label className="block text-xs text-gray-600">End<input className={input} type="date" required min={definition.date_range.start || undefined} value={definition.date_range.end} onChange={event => edit({ date_range: { ...definition.date_range, end: event.target.value } })} /></label></div>
              <label className="block text-xs text-gray-600">Group by<select className={input} value={definition.grain} onChange={event => edit({ grain: event.target.value })}>{["daily", "weekly", "monthly", "quarterly"].map(value => <option key={value}>{value}</option>)}</select></label>
              <details className="border-y border-gray-100 py-3"><summary className="cursor-pointer text-sm font-medium">Relationship analysis</summary><div className="mt-3 space-y-3">
                <label className="block text-xs text-gray-600">Correlation method<select className={input} value={definition.method} onChange={event => edit({ method: event.target.value as ReportDefinition["method"] })}><option value="spearman">Spearman</option><option value="pearson">Pearson</option></select></label>
                <label className="block text-xs text-gray-600">Minimum historical observations<input className={input} type="number" min={30} max={3653} required value={definition.filters.minimum_observations} onChange={event => edit({ filters: { ...definition.filters, minimum_observations: Number(event.target.value) } })} /></label>
                <label className="flex gap-2 text-sm"><input className="h-4 w-4" type="checkbox" checked={definition.lag.enabled} onChange={event => edit({ lag: { ...definition.lag, enabled: event.target.checked } })} />Evaluate timing</label>
                {definition.lag.enabled && <><label className="block text-xs text-gray-600">Maximum lag<input className={input} type="number" min={0} max={12} required value={definition.lag.maximum} onChange={event => edit({ lag: { ...definition.lag, maximum: Number(event.target.value) } })} /></label><label className="block text-xs text-gray-600">Direction<select className={input} value={definition.lag.direction} onChange={event => edit({ lag: { ...definition.lag, direction: event.target.value } })}><option value="a_leads_b">Earlier selected metric leads</option><option value="b_leads_a">Later selected metric leads</option></select></label></>}
              </div></details>
              <p className="text-sm text-gray-600">{definition.metrics.length} metrics / {datasetCount} datasets / {taskCount} tests</p>
              {taskCount > 1000 && <p className="text-sm text-amber-800">Report analysis exceeds the 1,000-test limit.</p>}
              <button type="submit" className={`${primaryButton} w-full`} disabled={datasetCount < 2 || taskCount > 1000 || definition.metrics.length > 25 || busy}>{busy ? <LoaderCircle size={16} className="animate-spin" /> : <Play size={16} />}{t("Preview report")}</button>
            </section>
          </div>
        </fieldset>
      </form>
    </section>

    <section role="tabpanel" id="report-report" aria-labelledby="tab-report" hidden={view !== "report"} className="space-y-6">
      {!report ? <div className="border-y border-gray-200 py-12 text-center"><FileText className="mx-auto text-gray-400" size={32} /><h2 className="mt-3 text-lg font-medium">No report generated</h2><button type="button" className={`${button} mt-4`} onClick={() => setView("explore")}><ChartNoAxesCombined size={16} />{t("Build report")}</button></div> : <>
        <header className="border-b border-gray-200 pb-5"><div className="flex items-center gap-3"><WorkspaceBrandMark name={brand.name} logoUrl={brand.logoUrl} primaryColor={brand.primaryColor} className="h-10 w-10 rounded-md text-sm" /><span className="text-sm font-medium">{brand.name}</span></div><h2 className="mt-4 break-words text-2xl font-semibold">{report.name}</h2><p className="mt-2 break-words text-base text-gray-700">{report.business_question}</p><p className="mt-2 text-xs text-gray-500">{report.window.start} to {report.window.end} / {report.grain} / {report.dataset_count} datasets / Generated {report.generated_at.slice(0, 10)}</p></header>
        <ReportOverview report={report} />
        <MetricTrends report={report} />
        <section className="space-y-3 border-t border-gray-200 pt-5"><h3 className="text-lg font-semibold">Combined findings</h3><Statements statements={report.observations} /><Statements statements={report.contrasts} /></section>
        <section className="space-y-3 border-t border-gray-200 pt-5" aria-label="Relationship findings"><h3 className="text-lg font-semibold">Relationship findings</h3>
          {report.findings.length === 0 && <p className="text-sm text-gray-500">No cross-dataset relationships are available.</p>}
          {report.findings.map(finding => <div key={finding.id} className={`border-b border-gray-100 py-3 ${selectedIds.includes(finding.id) ? "" : "print:hidden"}`}><label className="flex items-start gap-3"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0 print:hidden" disabled={busy} checked={selectedIds.includes(finding.id)} onChange={event => chooseFinding(finding.id, event.target.checked)} aria-label={`Include ${finding.metric_a.label} and ${finding.metric_b.label} in report`} /><span className="min-w-0"><Finding finding={finding} /></span></label></div>)}
        </section>
        <section className="space-y-3 border-t border-gray-200 pt-5"><h3 className="text-lg font-semibold">Follow-up actions</h3><Statements statements={report.recommendations} /></section>
        <section className="space-y-3 border-t border-gray-200 pt-5"><h3 className="text-lg font-semibold">Decisions and outcomes</h3>{report.decisions.length === 0 ? <p className="text-sm text-gray-500">No linked decisions recorded.</p> : report.decisions.map(decision => <div key={decision.id} className="border-b border-gray-100 pb-3"><Link className="break-words font-medium text-blue-700 underline" href={`/dashboard/decisions/${decision.id}`}>{decision.title}</Link><p className="mt-1 text-xs text-gray-500">{decision.status} / Owner: {decision.owner_user_id}{decision.review_date ? ` / Review: ${decision.review_date.slice(0, 10)}` : ""}</p><p className="mt-2 text-sm">Expected: {decision.expected_outcome || "Not recorded"}</p><p className="mt-1 text-sm">Actual: {decision.actual_outcome || "Not yet recorded"}</p>{decision.change_percent !== null && <p className="mt-1 text-sm">Measured change: {decision.change_percent.toFixed(1)}%</p>}</div>)}</section>
        <section className="space-y-2 border-t border-gray-200 pt-5"><h3 className="text-base font-semibold">Evidence limitations</h3><p className="text-xs text-gray-500">Rule-based interpretation / Historical relationships: {report.history_window.start} to {report.history_window.end}</p><Statements statements={report.limitations} /></section>
      </>}
    </section>
  </div>
}

function Statements({ statements }: { statements: string[] }) {
  return statements.length > 0 ? <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-gray-700">{statements.map((text, index) => <li key={index} className="break-words">{text}</li>)}</ul> : null
}

function ReportOverview({ report }: { report: BusinessReport }) {
  return <section aria-label="Report coverage" className="space-y-2 border-b border-gray-200 pb-4"><div className="flex flex-wrap items-center gap-x-5 gap-y-2"><h2 className="text-base font-semibold">{report.status === "ready" ? "Cross-dataset coverage available" : "Limited cross-dataset coverage"}</h2><span className="text-xs text-gray-500">Previous period: {report.previous_window.start} to {report.previous_window.end}</span></div>{report.source_analysis && <p className="text-xs leading-5 text-gray-600">{report.source_analysis.note} <Link href={`/dashboard/relationships/explorer?run=${encodeURIComponent(report.source_analysis.run_id)}`} className="text-blue-700 underline">Original analysis</Link> / {report.source_analysis.engine_version}</p>}{report.warnings.length > 0 && <div className="border-l-2 border-amber-500 pl-3"><Statements statements={report.warnings} /></div>}</section>
}

function Finding({ finding }: { finding: ReportFinding }) {
  return <><span className="block break-words text-sm font-semibold">{finding.metric_a.dataset_label} / {finding.metric_a.label} <span className="font-normal text-gray-500">and</span> {finding.metric_b.dataset_label} / {finding.metric_b.label}</span><span className="mt-1 block text-xs text-gray-500">{finding.reliability.replaceAll("_", " ")} / {finding.observations} observations / Lag {finding.lag} {finding.lag_unit}</span><span className="mt-2 block text-sm leading-6 text-gray-700">{finding.interpretation}</span>{finding.warnings.length > 0 && <span className="mt-1 block break-words text-xs text-amber-800">{finding.warnings.map(value => value.replaceAll("_", " ")).join("; ")}</span>}</>
}

export function MetricTrends({ report }: { report: BusinessReport }) {
  return <section className={`grid min-w-0 gap-4 md:grid-cols-2 ${report.metrics.length >= 3 ? "xl:grid-cols-3" : ""}`} aria-label="Metric comparisons">
    {report.metrics.map(metric => <article key={metric.id} className="min-w-0 rounded-md border border-gray-200 bg-white p-4">
      <h3 className="break-words text-sm font-semibold">{metric.label}</h3>
      <p className="mt-1 break-words text-xs text-gray-500">{metric.dataset_label} / {metric.currency || metric.unit} / {metric.aggregation}</p>
      <p className="mt-3 break-words text-2xl font-semibold tabular-nums">{formatReportValue(metric.value, metric.currency)}</p>
      <p className="mt-1 text-sm text-gray-600">{metric.change_percent === null ? "Percentage change unavailable" : `${metric.change_percent >= 0 ? "+" : ""}${metric.change_percent.toFixed(1)}% versus previous period`}</p>
      <p className="mt-1 text-xs text-gray-500">Previous: {formatReportValue(metric.previous_value, metric.currency)} / Coverage: {metric.observations}/{metric.expected_periods}</p>
      <div className="mt-4 h-36 min-w-0" role="img" aria-label={`${metric.label} trend from ${report.window.start} to ${report.window.end}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={metric.trend}>
            <CartesianGrid stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="period" hide />
            <YAxis hide domain={["auto", "auto"]} />
            <Tooltip formatter={(value) => formatReportValue(typeof value === "number" ? value : Number(value), metric.currency)} />
            <Line type="linear" dataKey="value" stroke="#2563eb" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {metric.warnings.length > 0 && <details className="mt-2 text-xs text-amber-800"><summary className="cursor-pointer">Coverage notes</summary><Statements statements={metric.warnings} /></details>}
    </article>)}
  </section>
}
