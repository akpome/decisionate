"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CalendarDays, ChartNoAxesCombined, FileText, LoaderCircle, Play, Printer, RefreshCw, Save, Trash2 } from "lucide-react"
import { correlationRequest, getMyOrganization, getOrganizationWorkspaces } from "@/lib/api"
import { defaultWorkspaceBrand, getWorkspaceBrand, type WorkspaceBrand } from "@/lib/workspace-brand"
import { WorkspaceBrandMark } from "@/app/dashboard/workspace-brand-mark"
import { useDecisionateText } from "@/app/use-decisionate-language"
import type { CatalogDataset } from "@/features/relationships/types"
import { CorrelationInsights } from "@/features/relationships/correlation-widgets"
import { getAIAnalysisProvenance } from "@/features/ai/lib/analysis-copy"
import { AnalysisNavigation } from "./analysis-navigation"
import { ReportMetricPicker, reportDateColumn } from "./report-metric-picker"
import { loadReportCatalogPage } from "./report-catalog-loading"
import { editableDefinition, type BusinessReport, type ReportDefinition } from "./types"
import { MetricTrends } from "./report-metric-trends"
import { ReportDecisions, ReportRelationshipFindings } from "./report-evidence-sections"
import { defaultReportName, isDefaultReportName, reportDraftName } from "./default-report-name"
import { reportPairDirections, reportPairKey, reportTestCount } from "./pair-directions"
import { ReportPairDirections } from "./report-pair-directions"
import { ReportAnomalies } from "./report-anomalies"
import { historicalEvidenceHref } from "./legacy-relationship-destination"

const input = "mt-1 min-h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-950"
const command = "inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
const button = `${command} border-gray-300 bg-white`
const primaryButton = `${command} border-blue-700 bg-blue-700 text-white`
type SavedReport = { report_id: string; name: string; created_at: string }
type WeeklyTemplate = { report_id: string | null; name: string | null; enabled: boolean }
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Report unavailable. Your selections have been preserved."

const mergeCatalog = (current: CatalogDataset[], added: CatalogDataset[]) => [...new Map([...current, ...added].map(item => [item.dataset_id, item])).values()]

async function hydrateCatalog(userId: string, workspaceId: string | undefined, current: CatalogDataset[], value: ReportDefinition, signal: AbortSignal) {
  let result = current
  for (const identity of new Set(value.metrics.map(metric => metric.dataset_id))) {
    if (signal.aborted) return result
    if (result.some(dataset => dataset.dataset_id === identity)) continue
    const page = await correlationRequest<{ datasets: CatalogDataset[] }>(userId, `/business-reports/catalog?dataset_id=${identity}`, { signal }, workspaceId)
    result = mergeCatalog(result, page.datasets)
  }
  return result
}

export function ReportWorkspace({ userId, workspaceId, canManage, canSave, canEditDecisions = false, initialScope = "multi" }: {
  userId: string; workspaceId?: string; canManage: boolean; canSave: boolean; canEditDecisions?: boolean; initialScope?: "single" | "multi"
}) {
  const { t } = useDecisionateText()
  const router = useRouter()
  const openingDraft = useRef(false)
  const draftName = useRef("")
  const managementAction = useRef(false)
  const deletedReports = useRef(new Set<string>())
  const routeController = useRef<AbortController | null>(null)
  const [datasets, setDatasets] = useState<CatalogDataset[]>([])
  const [dateColumns, setDateColumns] = useState<Record<number, string>>({})
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [catalogOffset, setCatalogOffset] = useState(0)
  const [catalogReload, setCatalogReload] = useState(0)
  const [catalogBusy, setCatalogBusy] = useState(true)
  const [catalogError, setCatalogError] = useState(false)
  const [historyError, setHistoryError] = useState(false)
  const [historyReload, setHistoryReload] = useState(0)
  const [weeklyTemplate, setWeeklyTemplate] = useState<WeeklyTemplate | null>(null)
  const [templateError, setTemplateError] = useState(false)
  const [templateReload, setTemplateReload] = useState(0)
  const [saved, setSaved] = useState<SavedReport[]>([])
  const [definition, setDefinition] = useState<ReportDefinition>(() => editableDefinition({ scope: initialScope }))
  const [report, setReport] = useState<BusinessReport | null>(null)
  const [view, setView] = useState<"explore" | "report">("explore")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [brand, setBrand] = useState<WorkspaceBrand>(defaultWorkspaceBrand)
  const request = <T,>(path: string, init: RequestInit = {}) => correlationRequest<T>(userId, `/business-reports${path}`, init, workspaceId)
  const datasetCount = new Set(definition.metrics.map(metric => metric.dataset_id)).size
  const single = definition.scope === "single"
  const taskCount = reportTestCount(definition.metrics, definition.pair_directions, definition.lag)
  const showPairDirections = definition.lag.enabled && definition.pair_directions.length > 0
  const previewButton = <button type="submit" className={`${primaryButton} w-full`} disabled={datasetCount < (single ? 1 : 2) || taskCount > 1000 || definition.metrics.length > 25 || busy}>{busy ? <LoaderCircle size={16} className="animate-spin" /> : <Play size={16} />}{t("Preview report")}</button>

  useEffect(() => {
    const controller = new AbortController()
    const request = <T,>(path: string, init: RequestInit) => correlationRequest<T>(userId, `/business-reports${path}`, init, workspaceId)
    void loadReportCatalogPage(request, catalogOffset, controller.signal, page => {
      setDatasets(current => mergeCatalog(page.datasets, current)); setNextOffset(page.next_offset)
    }, dataset => setDatasets(current => mergeCatalog(current, [dataset])))
      .catch(() => { if (!controller.signal.aborted) setCatalogError(true) })
      .finally(() => { if (!controller.signal.aborted) setCatalogBusy(false) })
    return () => controller.abort()
  }, [userId, workspaceId, catalogOffset, catalogReload])

  useEffect(() => {
    const controller = new AbortController()
    void correlationRequest<SavedReport[]>(userId, "/business-reports", { signal: controller.signal }, workspaceId)
      .then(history => { if (!controller.signal.aborted) setSaved(current => [...new Map([...history, ...current].filter(item => !deletedReports.current.has(item.report_id)).map(item => [item.report_id, item])).values()]) })
      .catch(() => { if (!controller.signal.aborted) setHistoryError(true) })
    return () => controller.abort()
  }, [userId, workspaceId, historyReload])

  useEffect(() => {
    const controller = new AbortController()
    void correlationRequest<WeeklyTemplate>(userId, "/business-reports/weekly-template", { signal: controller.signal }, workspaceId)
      .then(value => { if (!controller.signal.aborted) { setWeeklyTemplate(value); setTemplateError(false) } })
      .catch(() => { if (!controller.signal.aborted) setTemplateError(true) })
    return () => controller.abort()
  }, [userId, workspaceId, templateReload])

  useEffect(() => {
    let current = true
    const controller = new AbortController()
    routeController.current = controller
    async function addSelectedDatasets(value: ReportDefinition) {
      try {
        const hydrated = await hydrateCatalog(userId, workspaceId, [], value, controller.signal)
        if (current) setDatasets(existing => mergeCatalog(existing, hydrated))
      } catch { if (current) setCatalogError(true) }
    }
    async function load() {
      try {
        const params = new URLSearchParams(window.location.search)
        if (!params.get("report") && !params.get("weekly")) {
          if (!draftName.current) draftName.current = reportDraftName()
          setDefinition(current => ({ ...current, name: current.name || draftName.current }))
        }
        if (params.get("report")) {
          const result = await correlationRequest<BusinessReport>(userId, `/business-reports/${encodeURIComponent(params.get("report")!)}`, { signal: controller.signal }, workspaceId)
          if (!current) return
          setReport(result); setDefinition(editableDefinition(result.definition)); setView("report")
          void addSelectedDatasets(result.definition)
        } else if (params.get("weekly")) {
          const result = await correlationRequest<BusinessReport>(userId, "/business-reports/weekly-preview", { signal: controller.signal }, workspaceId)
          if (!current) return
          setReport(result); setDefinition(editableDefinition(result.definition)); setView("report")
          void addSelectedDatasets(result.definition)
        } else if (params.get("run")) {
          const result = await correlationRequest<ReportDefinition>(userId, `/business-reports/from-run/${encodeURIComponent(params.get("run")!)}`, { signal: controller.signal }, workspaceId)
          if (!current) return
          setDefinition(editableDefinition({ ...result, name: draftName.current }))
          void addSelectedDatasets(result)
        } else if (params.get("dataset")) {
          const identity = Number(params.get("dataset"))
          if (Number.isSafeInteger(identity) && identity > 0) {
            const selectedDataset = await correlationRequest<{ datasets: CatalogDataset[] }>(userId, `/business-reports/catalog?dataset_id=${identity}`, { signal: controller.signal }, workspaceId)
            if (!current) return
            setDatasets(existing => mergeCatalog(existing, selectedDataset.datasets))
            const dataset = selectedDataset.datasets[0]
            const metric = dataset?.metrics.find(item => item.metric_key === params.get("metric")) || dataset?.metrics[0]
            const dateColumn = dataset?.date_columns[0]
            if (metric && dateColumn) {
              setDefinition(current => editableDefinition({ ...current, metrics: [{ dataset_id: identity, metric_key: metric.metric_key, date_column: dateColumn, aggregation: metric.aggregation }], date_range: dataset.availability[dateColumn] }))
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
    return () => { current = false; controller.abort() }
  }, [userId, workspaceId])

  function refreshCatalog() {
    if (catalogBusy) return
    setCatalogBusy(true); setCatalogError(false)
    setCatalogOffset(0); setCatalogReload(value => value + 1)
  }

  function edit(patch: Partial<ReportDefinition>) {
    const analysisChanged = ["metrics", "date_range", "grain", "method", "filters", "lag", "pair_directions", "seasonal_business"].some(key => key in patch)
    const nextName = report?.report_id && !("name" in patch) && isDefaultReportName(definition.name) ? defaultReportName() : null
    setDefinition(current => {
      const next = { ...current, ...(nextName ? { name: nextName } : {}), ...patch, ...(analysisChanged ? { included_findings: null } : {}) }
      return { ...next, pair_directions: reportPairDirections(next.metrics, next.pair_directions) }
    })
    setReport(null); setError(""); setMessage("")
  }

  function toggleMetric(dataset: CatalogDataset, key: string) {
    const metric = dataset.metrics.find(item => item.metric_key === key)!
    const existing = definition.metrics.find(item => item.dataset_id === dataset.dataset_id && item.metric_key === key)
    const dateColumn = reportDateColumn(dataset, definition.metrics, dateColumns)
    const retained = single ? definition.metrics.filter(item => item.dataset_id === dataset.dataset_id) : definition.metrics
    const metrics = existing ? definition.metrics.filter(item => item !== existing) : [...retained, {
      dataset_id: dataset.dataset_id, metric_key: key, date_column: dateColumn, aggregation: metric.aggregation,
    }]
    const availability = dataset.availability[dateColumn]
    let range = definition.date_range
    if ((!range.end || single && datasetCount > 0 && !definition.metrics.some(item => item.dataset_id === dataset.dataset_id)) && availability) {
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
      const result = await request<BusinessReport>("/preview", { method: "POST", body: JSON.stringify({ ...definition, included_findings: null }) })
      setDefinition(editableDefinition(result.definition))
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

  async function openDecisionDraft(decisionId?: number) {
    if (!canEditDecisions || !canSave || busy || openingDraft.current) return
    openingDraft.current = true
    try {
      await execute(async () => {
        const linkedReportId = decisionId === undefined ? null : report?.decision_drafts?.find(item => item.id === decisionId)?.report_id
        const snapshot = linkedReportId ? { report_id: linkedReportId } : await saveSnapshot()
        if (decisionId === undefined) {
          const query = new URLSearchParams({ report: snapshot.report_id!, returnTo: `/dashboard/reports?report=${snapshot.report_id}` })
          router.push(`/dashboard/decisions/new?${query}`)
          return
        }
        const result = await request<{ decision_id: number }>(`/${snapshot.report_id}/decision-drafts/${decisionId}/evidence`, { method: "POST" })
        router.push(`/dashboard/decisions/${result.decision_id}`)
      })
    } finally { openingDraft.current = false }
  }

  async function saveWeeklyTemplate() {
    if (single || !canManage || busy || managementAction.current) return
    managementAction.current = true
    try {
      await execute(async () => {
        const value = await saveSnapshot()
        const result = await request<{ enabled: boolean }>(`/${value.report_id}/weekly`, { method: "POST" })
        setWeeklyTemplate({ report_id: value.report_id!, name: value.name, enabled: result.enabled })
        setTemplateReload(current => current + 1)
        setMessage("Weekly report template saved. Existing recipients and sending preferences are unchanged.")
      })
    } finally { managementAction.current = false }
  }

  async function deleteSavedReport() {
    const identity = report?.report_id
    if (!identity || !canManage || busy || managementAction.current) return
    if (!window.confirm(`${t("Delete saved report")}: "${report.name}"?\n${t("Linked decisions and datasets will be kept. If this is the weekly template, weekly delivery will be paused.")}`)) return
    managementAction.current = true
    try {
      await execute(async () => {
        const result = await request<{ weekly_template_removed: boolean }>(`/${encodeURIComponent(identity)}`, { method: "DELETE" })
        deletedReports.current.add(identity)
        setSaved(current => current.filter(item => item.report_id !== identity))
        setReport(null); setView("explore")
        window.history.replaceState(null, "", single ? "/dashboard/reports/dataset" : "/dashboard/reports")
        if (result.weekly_template_removed) setWeeklyTemplate({ report_id: null, name: null, enabled: false })
        setTemplateReload(current => current + 1)
        setMessage(result.weekly_template_removed ? "Saved report deleted and weekly delivery paused. Linked decisions and datasets were kept." : "Saved report deleted. Linked decisions and datasets were kept.")
      })
    } finally { managementAction.current = false }
  }

  async function removeWeeklyTemplate() {
    const identity = weeklyTemplate?.report_id
    if (!identity || !canManage || busy || managementAction.current) return
    if (!window.confirm(t("Remove the weekly report template and pause weekly delivery? The saved report and linked decisions will be kept."))) return
    managementAction.current = true
    try {
      await execute(async () => {
        const result = await request<WeeklyTemplate>(`/weekly-template?report_id=${encodeURIComponent(identity)}`, { method: "DELETE" })
        setWeeklyTemplate(result)
        setMessage("Weekly report template removed and delivery paused. The saved report and linked decisions were kept.")
      })
    } finally { managementAction.current = false; setTemplateReload(current => current + 1) }
  }

  if (loading) return <div className="min-w-0 w-full space-y-5"><AnalysisNavigation active={single ? "dataset-reports" : "reports"} /><p role="status" className="py-8 text-sm text-gray-600">Loading reports...</p></div>
  return <div className="min-w-0 w-full space-y-5">
    <AnalysisNavigation active={single ? "dataset-reports" : "reports"} />
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-4 print:hidden">
      <h1 className="text-2xl font-semibold">{t(single ? "Single dataset report" : "Multi dataset report")}</h1>
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
      <div className="flex w-full max-w-md items-end gap-2"><label className="block min-w-0 flex-1 text-xs text-gray-600">Saved reports<select className={input} disabled={busy} value={report?.report_id || ""} onChange={event => {
        const id = event.target.value
        if (!id) return
        void execute(async () => {
          const result = await request<BusinessReport>(`/${id}`)
          setReport(result); setDefinition(editableDefinition(result.definition)); setDateColumns({}); setView("report")
          window.history.replaceState(null, "", `/dashboard/reports?report=${id}`)
          const signal = routeController.current?.signal
          if (signal) void hydrateCatalog(userId, workspaceId, datasets, result.definition, signal)
            .then(hydrated => { if (!signal.aborted) setDatasets(existing => mergeCatalog(existing, hydrated)) })
            .catch(() => { if (!signal.aborted) setCatalogError(true) })
        })
      }}><option value="">Unsaved analysis</option>{saved.map(item => <option key={item.report_id} value={item.report_id}>{item.name} / {item.created_at.slice(0, 10)}</option>)}</select></label>
        {canManage && report?.report_id && <button type="button" className={`${button} text-red-700`} disabled={busy} title={t("Delete saved report")} aria-label={t("Delete saved report")} onClick={() => void deleteSavedReport()}><Trash2 size={16} /></button>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={busy || catalogBusy} title="Refresh available datasets" aria-label="Refresh available datasets" onClick={refreshCatalog}>{catalogBusy ? <LoaderCircle size={16} className="animate-spin" /> : <RefreshCw size={16} />}</button>
        {report && <>
          <button type="button" className={button} disabled={busy || !canSave || Boolean(report.report_id)} onClick={() => void execute(async () => { await saveSnapshot(); setMessage("Report snapshot saved.") })}><Save size={16} />Save snapshot</button>
          {!single && <button type="button" className={button} disabled={busy || !canManage || weeklyTemplate?.report_id === report.report_id && Boolean(report.report_id)} onClick={() => void saveWeeklyTemplate()}><CalendarDays size={16} />{weeklyTemplate?.report_id === report.report_id && report.report_id ? "Weekly template selected" : "Use for weekly report"}</button>}
          {view === "report" && <button type="button" className={button} title="Print or save as PDF" aria-label="Print or save as PDF" onClick={() => window.print()}><Printer size={17} /></button>}
        </>}
        <Link href="/dashboard/alerts" className={button}><CalendarDays size={16} />Weekly delivery</Link>
      </div>
    </div>
    {historyError && <div className="flex flex-wrap items-center gap-3 text-sm text-amber-900"><p role="alert">{t("Saved reports could not be loaded.")}</p><button type="button" className={button} onClick={() => { setHistoryError(false); setHistoryReload(value => value + 1) }}><RefreshCw size={16} />{t("Retry")}</button></div>}
    {templateError && <div className="flex flex-wrap items-center gap-3 text-sm text-amber-900"><p role="alert">{t("Weekly report template could not be loaded.")}</p><button type="button" className={button} title={t("Retry weekly report template")} aria-label={t("Retry weekly report template")} onClick={() => setTemplateReload(value => value + 1)}><RefreshCw size={16} /></button></div>}
    {weeklyTemplate?.report_id && <section aria-label="Weekly report template" className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-4 print:hidden">
      <div className="min-w-0"><h2 className="text-xs font-medium text-gray-600">{t("Weekly report template")}</h2><Link className="mt-1 block break-words text-sm font-medium text-blue-700 underline" href={`/dashboard/reports?report=${encodeURIComponent(weeklyTemplate.report_id)}`}>{weeklyTemplate.name || t("Unavailable saved report")}</Link><p className="mt-1 text-xs text-gray-500">{t(weeklyTemplate.enabled ? "Weekly delivery enabled" : "Weekly delivery paused")}</p></div>
      {canManage && <button type="button" className={`${button} text-red-700`} disabled={busy} title={t("Remove weekly report template")} aria-label={t("Remove weekly report template")} onClick={() => void removeWeeklyTemplate()}><Trash2 size={16} /></button>}
    </section>}

    <section role="tabpanel" id="report-explore" aria-labelledby="tab-explore" hidden={view !== "explore"} className="space-y-6 print:hidden">
      <form onSubmit={event => { event.preventDefault(); void calculate() }}>
        <fieldset disabled={busy} className="min-w-0 space-y-5">
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <div className="min-w-0"><label htmlFor="report-name" className="block text-xs font-medium text-gray-700">Report name</label><input id="report-name" aria-describedby="report-name-hint" className={input} required maxLength={120} value={definition.name} onChange={event => edit({ name: event.target.value })} /><p id="report-name-hint" className="mt-1 text-xs text-gray-500">{t("Edit this report name to suit your analysis.")}</p></div>
            <label className="block text-xs font-medium text-gray-700">Business question<input className={input} required minLength={8} maxLength={1000} value={definition.business_question} onChange={event => edit({ business_question: event.target.value })} /></label>
          </div>
          <div className="grid min-w-0 items-start gap-6 border-y border-gray-200 py-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <ReportMetricPicker datasets={datasets} metrics={definition.metrics} dateColumns={dateColumns} singleDataset={single} loading={catalogBusy} error={catalogError} onRetry={refreshCatalog} onToggleMetric={toggleMetric} onDateColumnChange={(dataset, column) => {
              setDateColumns(current => ({ ...current, [dataset.dataset_id]: column }))
              edit({ metrics: definition.metrics.map(item => item.dataset_id === dataset.dataset_id ? { ...item, date_column: column } : item) })
            }} footer={nextOffset !== null && <button type="button" className={button} disabled={busy || catalogBusy} onClick={() => { setCatalogBusy(true); setCatalogError(false); setCatalogOffset(nextOffset) }}>Load more datasets</button>} />
            <section className="report-builder-section gap-4" aria-label="Analysis settings">
              <h2 className="shrink-0 text-base font-semibold">Analysis settings</h2>
              <div className="grid shrink-0 grid-cols-2 gap-3"><label className="block text-xs text-gray-600">Start<input className={input} type="date" required max={definition.date_range.end || undefined} value={definition.date_range.start} onChange={event => edit({ date_range: { ...definition.date_range, start: event.target.value } })} /></label><label className="block text-xs text-gray-600">End<input className={input} type="date" required min={definition.date_range.start || undefined} value={definition.date_range.end} onChange={event => edit({ date_range: { ...definition.date_range, end: event.target.value } })} /></label></div>
              <div role="group" aria-label="Analysis settings" tabIndex={0} className="report-builder-scroll space-y-4 pr-2 focus-visible:outline-2 focus-visible:outline-blue-600">
                <label className="block text-xs text-gray-600">Group by<select className={input} value={definition.grain} onChange={event => edit({ grain: event.target.value })}>{["daily", "weekly", "monthly", "quarterly"].map(value => <option key={value}>{value}</option>)}</select></label>
                <label className="flex items-start gap-2 text-sm"><input className="mt-0.5 h-4 w-4 shrink-0" type="checkbox" checked={definition.seasonal_business} onChange={event => edit({ seasonal_business: event.target.checked })} />{t("Business has seasonal activity")}</label>
                <label className="flex items-start gap-2 text-sm"><input className="mt-0.5 h-4 w-4 shrink-0" type="checkbox" checked={definition.include_ai_analysis} onChange={event => edit({ include_ai_analysis: event.target.checked })} />{t("Include AI interpretation")}</label>
                {!single && <section aria-label="Relationship analysis" className="border-y border-gray-100 py-3"><h3 className="text-sm font-medium">{t("Relationship analysis")}</h3><div className="mt-3 space-y-3">
                  <label className="block text-xs text-gray-600">Correlation method<select className={input} value={definition.method} onChange={event => edit({ method: event.target.value as ReportDefinition["method"] })}><option value="spearman">Spearman</option><option value="pearson">Pearson</option></select></label>
                  <label className="block text-xs text-gray-600">Minimum historical observations<input className={input} type="number" min={24} max={3653} required value={definition.filters.minimum_observations} onChange={event => edit({ filters: { ...definition.filters, minimum_observations: Number(event.target.value) } })} /></label>
                  <label className="flex gap-2 text-sm"><input className="h-4 w-4" type="checkbox" checked={definition.lag.enabled} onChange={event => edit({ lag: { ...definition.lag, enabled: event.target.checked } })} />Evaluate timing</label>
                  {definition.lag.enabled && <label className="block text-xs text-gray-600">Maximum lag<input className={input} type="number" min={definition.lag.minimum} max={12} required value={definition.lag.maximum} onChange={event => edit({ lag: { ...definition.lag, maximum: Number(event.target.value) } })} /></label>}
                  {showPairDirections && <ReportPairDirections pairs={definition.pair_directions} datasets={datasets} onChange={(pair, direction) => edit({ pair_directions: definition.pair_directions.map(item => reportPairKey(item) === reportPairKey(pair) ? { ...item, direction } : item) })} />}
                </div></section>}
              </div>
              <p className="shrink-0 text-sm text-gray-600">{definition.metrics.length} metrics / {datasetCount} datasets / {taskCount} tests</p>
              {taskCount > 1000 && <p className="shrink-0 text-sm text-amber-800">Report analysis exceeds the 1,000-test limit.</p>}
              {previewButton}
            </section>
          </div>
        </fieldset>
      </form>
    </section>

    <section role="tabpanel" id="report-report" aria-labelledby="tab-report" hidden={view !== "report"} className="space-y-6">
      {!report ? <div className="border-y border-gray-200 py-12 text-center"><FileText className="mx-auto text-gray-400" size={32} /><h2 className="mt-3 text-lg font-medium">No report generated</h2><button type="button" className={`${button} mt-4`} onClick={() => setView("explore")}><ChartNoAxesCombined size={16} />{t("Build report")}</button></div> : <>
        <header className="border-b border-gray-200 pb-5"><div className="flex items-center gap-3"><WorkspaceBrandMark name={brand.name} logoUrl={brand.logoUrl} primaryColor={brand.primaryColor} className="h-10 w-10 rounded-md text-sm" /><span className="text-sm font-medium">{brand.name}</span></div><h2 className="mt-4 break-words text-2xl font-semibold">{report.name}</h2><p className="mt-2 break-words text-base text-gray-700">{report.business_question}</p><p className="mt-2 text-xs text-gray-500">{report.window.start} to {report.window.end} / {report.grain} / {report.dataset_count} datasets / Generated {report.generated_at.slice(0, 10)}</p></header>
        <ReportOverview report={report} />
        {report.ai_analysis && <section aria-label="Report interpretation" className="space-y-3 border-b border-gray-200 pb-5"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-lg font-semibold">{t("Report interpretation")}</h3><span className="text-xs text-gray-500">{report.ai_analysis.confidence} confidence</span></div><p className="text-xs text-gray-500">{getAIAnalysisProvenance(report.ai_analysis)}</p><p className="break-words text-sm leading-6 text-gray-700">{report.ai_analysis.summary}</p><Statements statements={report.ai_analysis.recommendations} /><Statements statements={report.ai_analysis.risks} /></section>}
        <MetricTrends report={report} />
        <ReportAnomalies analysis={report.anomaly_analysis} />
        <section aria-label="Analysis findings" className="space-y-3 border-t border-gray-200 pt-5"><h3 className="text-lg font-semibold">{single ? "Metric findings" : "Combined findings"}</h3>{report.observations.length + report.contrasts.length === 0 && <p className="text-sm text-gray-500">No comparable metric movements are available. Check coverage and previous-period baselines.</p>}<Statements statements={report.observations} /><Statements statements={report.contrasts} /></section>
        {!single && <ReportRelationshipFindings report={report} />}
        <section className="space-y-3 border-t border-gray-200 pt-5"><h3 className="text-lg font-semibold">Follow-up actions</h3><Statements statements={report.recommendations} /></section>
        <ReportDecisions report={report} onOpenDraft={canEditDecisions && canSave ? openDecisionDraft : undefined} busy={busy} />
        <section className="space-y-2 border-t border-gray-200 pt-5"><h3 className="text-base font-semibold">Evidence limitations</h3><p className="text-xs text-gray-500">Rule-based interpretation{!single && <> / Historical relationships: {report.history_window.start} to {report.history_window.end}</>}</p><Statements statements={report.limitations} /></section>
      </>}
    </section>
    {!single && <div className="print:hidden"><CorrelationInsights key={`${userId}:${workspaceId}`} userId={userId} workspaceId={workspaceId} /></div>}
  </div>
}

function Statements({ statements }: { statements: string[] }) {
  return statements.length > 0 ? <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-gray-700">{statements.map((text, index) => <li key={index} className="break-words">{text}</li>)}</ul> : null
}

function ReportOverview({ report }: { report: BusinessReport }) {
  const single = report.definition.scope === "single"
  return <section aria-label="Report coverage" className="space-y-2 border-b border-gray-200 pb-4"><div className="flex flex-wrap items-center gap-x-5 gap-y-2"><h2 className="text-base font-semibold">{single ? report.status === "ready" ? "Dataset coverage available" : "Limited dataset coverage" : report.status === "ready" ? "Cross-dataset coverage available" : "Limited cross-dataset coverage"}</h2><span className="text-xs text-gray-500">Previous period: {report.previous_window.start} to {report.previous_window.end}</span></div>{report.source_analysis && <p className="text-xs leading-5 text-gray-600">{report.source_analysis.note} <Link href={historicalEvidenceHref(report.source_analysis.run_id)} className="text-blue-700 underline">Original analysis</Link> / {report.source_analysis.engine_version}</p>}{report.warnings.length > 0 && <div className="border-l-2 border-amber-500 pl-3"><Statements statements={report.warnings} /></div>}</section>
}
