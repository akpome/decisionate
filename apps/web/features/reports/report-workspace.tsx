"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { CalendarDays, ChartNoAxesCombined, FileText, LoaderCircle, Play, Printer, RefreshCw, Save, Square, Trash2 } from "lucide-react"
import { correlationRequest, getMyOrganization, getOrganizationWorkspaces } from "@/lib/api"
import { defaultWorkspaceBrand, getWorkspaceBrand, type WorkspaceBrand } from "@/lib/workspace-brand"
import { WorkspaceBrandMark } from "@/app/dashboard/workspace-brand-mark"
import { useDecisionateText } from "@/app/use-decisionate-language"
import type { CatalogDataset } from "@/features/relationships/types"
import { CorrelationInsights } from "@/features/relationships/correlation-widgets"
import { getAIAnalysisProvenance } from "@/features/ai/lib/analysis-copy"
import { AnalysisNavigation } from "./analysis-navigation"
import { ReportMetricPicker, reportDateColumn } from "./report-metric-picker"
import { loadReportCatalogDataset, loadReportCatalogPage, mergeReportCatalog as mergeCatalog } from "./report-catalog-loading"
import { editableDefinition, selectedReportDimensionFilters, type BusinessReport, type ReportDefinition } from "./types"
import { ReportDecisions, ReportRelationshipFindings } from "./report-evidence-sections"
import { defaultReportName, isDefaultReportName, reportDraftName } from "./default-report-name"
import { reportExcludedPairs, reportPairDirections, reportPairKey, reportTestCount, unorderedReportPairKey } from "./pair-directions"
import { ReportPairDirections } from "./report-pair-directions"
import { ReportAnomalies } from "./report-anomalies"
import { ReportGrouping } from "./report-grouping"
import { historicalEvidenceHref } from "./legacy-relationship-destination"
import { analysisPhaseLabel, waitForAnalysis, type AnalysisJob } from "./analysis-jobs"
import { dimensionFilterLabel } from "@/features/datasets/components/dimension-filter"
import { MAXIMUM_RELATIONSHIP_OBSERVATIONS, MINIMUM_RELATIONSHIP_OBSERVATIONS, RELATIONSHIP_DEFAULTS } from "@/features/relationships/defaults"
import { impactReady, newImpactStudy, retainedImpactStudy, type ImpactStudy } from "./impact-types"
import { ImpactChange, ImpactSetup } from "./impact-setup"
import { ImpactResult } from "./impact-result"

const input = "mt-1 min-h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-950"
const command = "inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
const button = `${command} border-gray-300 bg-white`
const primaryButton = `${command} border-blue-700 bg-blue-700 text-white`
type SavedReport = { report_id: string; name: string; created_at: string }
type WeeklyTemplate = { report_id: string | null; name: string | null; enabled: boolean }
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Report unavailable. Your selections have been preserved."

const MetricTrends = dynamic(() => import("./report-metric-trends").then(module => module.MetricTrends), {
  loading: () => <div role="status" className="flex min-h-80 items-center justify-center gap-2 text-sm text-gray-600"><LoaderCircle size={16} className="animate-spin" />Loading charts...</div>,
})
const ImpactChart = dynamic(() => import("./impact-chart").then(module => module.ImpactChart), { ssr: false })

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
  const analysisSubmission = useRef(false)
  const draftName = useRef("")
  const managementAction = useRef(false)
  const catalogRetry = useRef(false)
  const deletedReports = useRef(new Set<string>())
  const routeController = useRef<AbortController | null>(null)
  const [datasets, setDatasets] = useState<CatalogDataset[]>([])
  const [dateColumns, setDateColumns] = useState<Record<number, string>>({})
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [catalogOffset, setCatalogOffset] = useState(0)
  const [catalogReload, setCatalogReload] = useState(0)
  const [catalogBusy, setCatalogBusy] = useState(true)
  const [catalogError, setCatalogError] = useState(false)
  const [retryingDataset, setRetryingDataset] = useState<number | null>(null)
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
  const [analysisJob, setAnalysisJob] = useState<AnalysisJob | null>(null)
  const [recentJobs, setRecentJobs] = useState<AnalysisJob[]>([])
  const [analysisHistoryReload, setAnalysisHistoryReload] = useState(0)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [brand, setBrand] = useState<WorkspaceBrand>(defaultWorkspaceBrand)
  const request = <T,>(path: string, init: RequestInit = {}) => correlationRequest<T>(userId, `/business-reports${path}`, init, workspaceId)
  const datasetCount = new Set(definition.metrics.map(metric => metric.dataset_id)).size
  const single = definition.scope === "single"
  const taskCount = reportTestCount(definition.metrics, definition.pair_directions, definition.lag, definition.excluded_pairs)
  const showPairDirections = definition.pair_directions.length > 0
  const previewButton = <button type="submit" className={`${primaryButton} w-full`} disabled={datasetCount < (single ? 1 : 2) || !impactReady(definition.impact, definition.metrics) || taskCount > 1000 || definition.metrics.length > 25 || selectedReportDimensionFilters(definition).some(item => !item.values.length) || busy}>{busy ? <LoaderCircle size={16} className="animate-spin" /> : <Play size={16} />}{t("Preview report")}</button>

  useEffect(() => {
    const controller = new AbortController()
    void correlationRequest<{ jobs: AnalysisJob[] }>(userId, "/business-reports/jobs", { signal: controller.signal }, workspaceId)
      .then(value => { if (!controller.signal.aborted) setRecentJobs(value.jobs.filter(job => ["report", "weekly_preview"].includes(job.kind))) })
      .catch(() => { /* A history lookup must not prevent a new analysis. */ })
    return () => controller.abort()
  }, [userId, workspaceId, analysisHistoryReload])

  useEffect(() => {
    const controller = new AbortController()
    const request = <T,>(path: string, init: RequestInit) => correlationRequest<T>(userId, `/business-reports${path}`, init, workspaceId)
    void loadReportCatalogPage(request, catalogOffset, controller.signal, page => {
      setDatasets(current => mergeCatalog(current, page.datasets)); setNextOffset(page.next_offset)
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
        if (params.get("job")) {
          setBusy(true)
          setLoading(false)
          try {
            let restored = false
            const value = await waitForAnalysis<BusinessReport | { cross_dataset_report: BusinessReport }>(
              (path, init) => correlationRequest(userId, `/business-reports${path}`, init, workspaceId),
              params.get("job")!, { signal: controller.signal, onUpdate: job => { if (current) {
                setAnalysisJob({ ...job, result: null })
                if (job.definition && !restored) {
                  restored = true
                  setDefinition(editableDefinition(job.definition))
                  void addSelectedDatasets(job.definition)
                }
              } } },
            )
            if (!current) return
            const result = "cross_dataset_report" in value ? value.cross_dataset_report : value
            setReport(result); setDefinition(editableDefinition(result.definition)); setView("report")
            void addSelectedDatasets(result.definition)
          } finally { if (current) setBusy(false) }
        } else if (params.get("report")) {
          const result = await correlationRequest<BusinessReport>(userId, `/business-reports/${encodeURIComponent(params.get("report")!)}`, { signal: controller.signal }, workspaceId)
          if (!current) return
          setReport(result); setDefinition(editableDefinition(result.definition)); setView("report")
          void addSelectedDatasets(result.definition)
        } else if (params.get("weekly")) {
          const request = <T,>(path: string, init: RequestInit = {}) => correlationRequest<T>(userId, `/business-reports${path}`, { ...init, signal: controller.signal }, workspaceId)
          const job = await request<AnalysisJob>("/weekly-jobs", { method: "POST" })
          if (!current) return
          setAnalysisJob(job); setBusy(true); setLoading(false)
          window.history.replaceState(null, "", `${window.location.pathname}?job=${encodeURIComponent(job.job_id)}`)
          const result = await waitForAnalysis<BusinessReport>(request, job.job_id, { signal: controller.signal, onUpdate: value => { if (current) setAnalysisJob(value) } })
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
            const dateColumn = dataset && reportDateColumn(dataset, [], {})
            if (metric && dateColumn) {
              setDefinition(current => editableDefinition({ ...current, metrics: [{ dataset_id: identity, metric_key: metric.metric_key, date_column: dateColumn, aggregation: metric.aggregation }], date_range: dataset.availability[dateColumn] }))
            }
          }
        }
      } catch (value) { if (current) setError(errorMessage(value)) }
      finally { if (current) { setLoading(false); setBusy(false); setAnalysisHistoryReload(value => value + 1) } }
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
    if (catalogBusy || catalogRetry.current) return
    setCatalogBusy(true); setCatalogError(false)
    setCatalogOffset(0); setCatalogReload(value => value + 1)
  }

  async function retryDataset(dataset: CatalogDataset) {
    const signal = routeController.current?.signal
    if (!signal || signal.aborted || catalogBusy || catalogRetry.current) return
    catalogRetry.current = true
    setRetryingDataset(dataset.dataset_id)
    try {
      const resolved = await loadReportCatalogDataset(request, dataset, signal)
      if (!signal.aborted) setDatasets(current => mergeCatalog(current, [resolved]))
    } catch { /* Navigation cancels the source retry without changing the new workspace. */ }
    finally {
      catalogRetry.current = false
      if (!signal.aborted) setRetryingDataset(null)
    }
  }

  function edit(patch: Partial<ReportDefinition>) {
    const analysisChanged = ["metrics", "dimension_filters", "date_range", "grain", "method", "filters", "lag", "pair_directions", "excluded_pairs", "seasonal_business", "impact"].some(key => key in patch)
    const nextName = report?.report_id && !("name" in patch) && isDefaultReportName(definition.name) ? defaultReportName() : null
    setDefinition(current => {
      const next = { ...current, ...(nextName ? { name: nextName } : {}), ...patch, ...(analysisChanged ? { included_findings: null } : {}) }
      return { ...next, impact: retainedImpactStudy(next.impact, next.metrics, "metrics" in patch || "dimension_filters" in patch), pair_directions: reportPairDirections(next.metrics, next.pair_directions), excluded_pairs: reportExcludedPairs(next.metrics, next.excluded_pairs) }
    })
    setReport(null); setError(""); setMessage("")
    setAnalysisJob(null)
    if (new URLSearchParams(window.location.search).has("job")) window.history.replaceState(null, "", window.location.pathname)
  }

  function editImpact(patch: Partial<ImpactStudy>) {
    if (definition.impact) edit({ impact: { ...definition.impact, ...patch } })
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
      range = { start: definition.impact ? availability.start : availability.start > start.toISOString().slice(0, 10) ? availability.start : start.toISOString().slice(0, 10), end: availability.end }
    }
    edit({ metrics, date_range: range })
  }

  async function execute(action: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("")
    try { await action() } catch (value) {
      if (errorMessage(value) === "Analysis cancelled") setMessage("Analysis cancelled.")
      else if (!routeController.current?.signal.aborted) setError(errorMessage(value))
    } finally { setBusy(false); setAnalysisHistoryReload(value => value + 1) }
  }

  async function calculate() {
    if (analysisSubmission.current || busy) return
    analysisSubmission.current = true
    try { await execute(async () => {
      const signal = routeController.current?.signal
      const job = await request<AnalysisJob>("/jobs", { method: "POST", signal, headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ ...definition, dimension_filters: selectedReportDimensionFilters(definition), included_findings: null }) })
      signal?.throwIfAborted()
      setAnalysisJob(job)
      setRecentJobs(current => [job, ...current.filter(item => item.job_id !== job.job_id)])
      window.history.replaceState(null, "", `${window.location.pathname}?job=${encodeURIComponent(job.job_id)}`)
      const result = await waitForAnalysis<BusinessReport>(request, job.job_id, { signal, onUpdate: setAnalysisJob })
      signal?.throwIfAborted()
      setDefinition(editableDefinition(result.definition))
      setReport(result)
      setView("report")
    }) } finally { analysisSubmission.current = false }
  }

  async function saveSnapshot() {
    if (report?.report_id) return report
    if (!report?.analysis_job_id) throw new Error("Generate a report preview before saving.")
    const result = await request<BusinessReport>(`/jobs/${encodeURIComponent(report.analysis_job_id)}/save`, { method: "POST" })
    setReport(result)
    setSaved(current => [{ report_id: result.report_id!, name: result.name, created_at: result.generated_at }, ...current.filter(item => item.report_id !== result.report_id)])
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
    {message && <p role="status" className="text-sm text-green-800">{t(message)}</p>}
    {recentJobs.length > 0 && <label className="block w-full max-w-md text-xs text-gray-600 print:hidden">{t("Recent analyses")}
      <select className={input} disabled={busy} value={analysisJob?.job_id || ""} onChange={event => {
        if (event.target.value) window.location.assign(`${window.location.pathname}?job=${encodeURIComponent(event.target.value)}`)
      }}><option value="">{t("Choose an analysis")}</option>{recentJobs.map(job => <option key={job.job_id} value={job.job_id}>{job.definition?.name || t("Weekly report")} / {t(analysisPhaseLabel(job.job_id === analysisJob?.job_id ? analysisJob.phase : job.phase))}</option>)}</select>
    </label>}
    {analysisJob && ["queued", "running"].includes(analysisJob.status) && <div className="flex flex-wrap items-center justify-between gap-3 border-y border-gray-200 py-3 print:hidden">
      <p role="status" className="flex items-center gap-2 text-sm"><LoaderCircle size={16} className="shrink-0 animate-spin" />{t(analysisPhaseLabel(analysisJob.phase))}</p>
      {!busy && <button type="button" className={button} onClick={() => window.location.reload()}><RefreshCw size={16} />{t("Reconnect")}</button>}
      <button type="button" className={button} onClick={() => void request<AnalysisJob>(`/jobs/${encodeURIComponent(analysisJob.job_id)}/cancel`, { method: "POST" }).then(setAnalysisJob).catch(value => setError(errorMessage(value)))}><Square size={14} />{t("Cancel analysis")}</button>
    </div>}
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
        <button type="button" className={button} disabled={busy || catalogBusy || retryingDataset !== null} title="Refresh available datasets" aria-label="Refresh available datasets" onClick={refreshCatalog}>{catalogBusy ? <LoaderCircle size={16} className="animate-spin" /> : <RefreshCw size={16} />}</button>
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
          {!single && <fieldset className="min-w-0"><legend className="mb-2 text-sm font-medium">Analysis type</legend><div className="inline-flex max-w-full flex-wrap gap-1 rounded-md border border-gray-200 bg-white p-1" role="group" aria-label="Analysis type">
            {[{ label: "Correlation analysis", impact: false }, { label: "Business impact analysis", impact: true }].map(mode => <button key={mode.label} type="button" aria-pressed={Boolean(definition.impact) === mode.impact} className={`min-h-10 min-w-0 rounded px-3 text-sm ${Boolean(definition.impact) === mode.impact ? "bg-blue-50 font-semibold text-blue-800" : "text-gray-600"}`} onClick={() => {
              if (Boolean(definition.impact) !== mode.impact) edit({ impact: mode.impact ? newImpactStudy() : null, ...(mode.impact && definition.grain === "quarterly" ? { grain: "weekly" } : {}) })
            }}>{mode.label}</button>)}
          </div></fieldset>}
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <div className="min-w-0"><label htmlFor="report-name" className="block text-xs font-medium text-gray-700">Report name</label><input id="report-name" aria-describedby="report-name-hint" className={input} required maxLength={120} value={definition.name} onChange={event => edit({ name: event.target.value })} /><p id="report-name-hint" className="mt-1 text-xs text-gray-500">{t("Edit this report name to suit your analysis.")}</p></div>
            <label className="block text-xs font-medium text-gray-700">Business question<input className={input} required minLength={8} maxLength={1000} value={definition.business_question} onChange={event => edit({ business_question: event.target.value })} /></label>
          </div>
          {definition.impact && <ImpactChange study={definition.impact} onChange={editImpact} />}
          <div className="grid min-w-0 items-start gap-6 border-y border-gray-200 py-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <ReportMetricPicker userId={userId} workspaceId={workspaceId} dimensionFilters={definition.dimension_filters} onDimensionFilterChange={(identity, filter) => edit({ dimension_filters: [
              ...(definition.dimension_filters || []).filter(item => item.dataset_id !== identity), ...(filter ? [{ dataset_id: identity, ...filter }] : []),
            ] })} datasets={datasets} metrics={definition.metrics} dateColumns={dateColumns} singleDataset={single} loading={catalogBusy} error={catalogError} onRetry={refreshCatalog} onRetryDataset={dataset => void retryDataset(dataset)} retryingDataset={retryingDataset} onToggleMetric={toggleMetric} onDateColumnChange={(dataset, column) => {
              setDateColumns(current => ({ ...current, [dataset.dataset_id]: column }))
              edit({ metrics: definition.metrics.map(item => item.dataset_id === dataset.dataset_id ? { ...item, date_column: column } : item) })
            }} footer={nextOffset !== null && <button type="button" className={button} disabled={busy || catalogBusy || retryingDataset !== null} onClick={() => { setCatalogBusy(true); setCatalogError(false); setCatalogOffset(nextOffset) }}>Load more datasets</button>} />
            <section className="report-builder-section gap-4" aria-label="Analysis settings">
              <h2 className="shrink-0 text-base font-semibold">Analysis settings</h2>
              <div className="grid shrink-0 grid-cols-2 gap-3"><label className="block text-xs text-gray-600">Start<input className={input} type="date" required max={definition.date_range.end || undefined} value={definition.date_range.start} onChange={event => edit({ date_range: { ...definition.date_range, start: event.target.value } })} /></label><label className="block text-xs text-gray-600">End<input className={input} type="date" required min={definition.date_range.start || undefined} value={definition.date_range.end} onChange={event => edit({ date_range: { ...definition.date_range, end: event.target.value } })} /></label></div>
              <div role="group" aria-label="Analysis settings" tabIndex={0} className="report-builder-scroll space-y-4 pr-2 focus-visible:outline-2 focus-visible:outline-blue-600">
                <label className="block text-xs text-gray-600">Analysis group by<select className={input} value={definition.grain} onChange={event => edit({ grain: event.target.value })}>{(definition.impact ? ["daily", "weekly", "monthly"] : ["daily", "weekly", "monthly", "quarterly"]).map(value => <option key={value}>{value}</option>)}</select></label>
                <label className="flex items-start gap-2 text-sm"><input className="mt-0.5 h-4 w-4 shrink-0" type="checkbox" checked={definition.seasonal_business} onChange={event => edit({ seasonal_business: event.target.checked })} />{t("Business has seasonal activity")}</label>
                {definition.impact && <><ImpactSetup study={definition.impact} datasets={datasets} metrics={definition.metrics} onChange={editImpact} /><p className="text-xs leading-5 text-gray-500">The dates must cover both before and after the change. {definition.grain === "weekly" ? "Allow at least 52 complete weeks before and 8 after." : definition.grain === "daily" ? "Allow at least 90 complete days before and 28 after." : "Allow at least 24 complete months before and 6 after."} Seasonal businesses need about two years before the change.</p></>}
                {!single && !definition.impact && <section aria-label="Relationship analysis" className="border-y border-gray-100 py-3"><h3 className="text-sm font-medium">{t("Relationship analysis")}</h3><div className="mt-3 space-y-3">
                  <label className="block text-xs text-gray-600">Correlation method<select className={input} value={definition.method} onChange={event => edit({ method: event.target.value as ReportDefinition["method"] })}><option value="spearman">Spearman</option><option value="pearson">Pearson</option></select></label>
                  <label className="block text-xs text-gray-600">Minimum historical observations<input className={input} type="number" min={MINIMUM_RELATIONSHIP_OBSERVATIONS} max={MAXIMUM_RELATIONSHIP_OBSERVATIONS} required value={definition.filters.minimum_observations} onChange={event => edit({ filters: { ...definition.filters, minimum_observations: Number(event.target.value) } })} /></label>
                  <section aria-label={t("Evaluate timing")} className="space-y-3"><h4 className="text-sm font-medium">{t("Evaluate timing")}</h4><label className="block text-xs text-gray-600">Maximum lag<input className={input} type="number" min={definition.lag.minimum} max={RELATIONSHIP_DEFAULTS.maximumLag} required value={definition.lag.maximum} onChange={event => edit({ lag: { ...definition.lag, maximum: Number(event.target.value) } })} /></label></section>
                  {showPairDirections && <ReportPairDirections pairs={definition.pair_directions} excludedPairs={definition.excluded_pairs} datasets={datasets}
                    onChange={(pair, direction) => edit({ pair_directions: definition.pair_directions.map(item => reportPairKey(item) === reportPairKey(pair) ? { ...item, direction } : item) })}
                    onRemove={pair => edit({ excluded_pairs: [...definition.excluded_pairs, pair] })}
                    onRestore={pair => edit({ excluded_pairs: definition.excluded_pairs.filter(item => unorderedReportPairKey(item) !== unorderedReportPairKey(pair)) })} />}
                </div></section>}
              </div>
              <p className="shrink-0 text-sm text-gray-600">{definition.metrics.length} metrics / {datasetCount} datasets{!definition.impact && <> / {taskCount} tests</>}</p>
              {taskCount > 1000 && <p className="shrink-0 text-sm text-amber-800">Report analysis exceeds the 1,000-test limit.</p>}
              {previewButton}
            </section>
          </div>
        </fieldset>
      </form>
    </section>

    <section role="tabpanel" id="report-report" aria-labelledby="tab-report" hidden={view !== "report"} className="space-y-6">
      {view !== "report" ? null : !report ? <div className="border-y border-gray-200 py-12 text-center"><FileText className="mx-auto text-gray-400" size={32} /><h2 className="mt-3 text-lg font-medium">No report generated</h2><button type="button" className={`${button} mt-4`} onClick={() => setView("explore")}><ChartNoAxesCombined size={16} />{t("Build report")}</button></div> : <>
        <header className="border-b border-gray-200 pb-5"><div className="flex items-center gap-3"><WorkspaceBrandMark name={brand.name} logoUrl={brand.logoUrl} primaryColor={brand.primaryColor} className="h-10 w-10 rounded-md text-sm" /><span className="text-sm font-medium">{brand.name}</span></div><h2 className="mt-4 break-words text-2xl font-semibold">{report.name}</h2><p className="mt-2 break-words text-base text-gray-700">{report.business_question}</p><p className="mt-2 text-xs text-gray-500">{report.window.start} to {report.window.end} / {report.dataset_count} datasets / Generated {report.generated_at.slice(0, 10)}</p><ReportGrouping report={report} /></header>
        <ImpactResult analysis={report.impact_analysis} />
        {report.impact_analysis && <ImpactChart analysis={report.impact_analysis} />}
        <SupportingEvidence collapsed={Boolean(report.impact_analysis)}>
        <ReportOverview report={report} />
        {(report.definition.dimension_filters || []).map(selection => <p key={selection.dataset_id} className="break-words text-sm text-gray-600"><span className="font-medium">{report.metrics.find(metric => metric.dataset_id === selection.dataset_id)?.dataset_label || `Dataset ${selection.dataset_id}`}</span> / {dimensionFilterLabel(selection)}</p>)}
        {report.ai_analysis && <section aria-label="Report interpretation" className="space-y-3 border-b border-gray-200 pb-5"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-lg font-semibold">{t("Report interpretation")}</h3><span className="text-xs text-gray-500">{report.ai_analysis.confidence} confidence</span></div><p className="text-xs text-gray-500">{getAIAnalysisProvenance(report.ai_analysis)}</p><p className="break-words text-sm leading-6 text-gray-700">{report.ai_analysis.summary}</p><Statements statements={report.ai_analysis.recommendations} /><Statements statements={report.ai_analysis.risks} /></section>}
        <MetricTrends report={report} />
        <ReportAnomalies analysis={report.anomaly_analysis} />
        <section aria-label="Analysis findings" className="space-y-3 border-t border-gray-200 pt-5"><h3 className="text-lg font-semibold">{single ? "Metric findings" : "What changed across your business"}</h3>{report.observations.length + report.contrasts.length === 0 && <p className="text-sm text-gray-500">There is no complete earlier period to compare these totals with. The relationship and business-change results below are checked separately.</p>}<Statements statements={report.observations} /><Statements statements={report.contrasts} /></section>
        {!single && <ReportRelationshipFindings report={report} />}
        {!report.impact_analysis && <section className="space-y-3 border-t border-gray-200 pt-5"><h3 className="text-lg font-semibold">Follow-up actions</h3><Statements statements={report.recommendations} /></section>}
        <details className="space-y-2 border-t border-gray-200 pt-5"><summary className="cursor-pointer text-sm font-medium">More about the evidence</summary><p className="text-xs text-gray-500">Calculated from your selected data{!single && <> / Earlier relationships: {report.history_window.start} to {report.history_window.end}</>}</p><Statements statements={report.limitations} /></details>
        </SupportingEvidence>
        <ReportDecisions report={report} onOpenDraft={canEditDecisions && canSave ? openDecisionDraft : undefined} busy={busy} />
      </>}
    </section>
    {!single && <div className="print:hidden"><CorrelationInsights key={`${userId}:${workspaceId}`} userId={userId} workspaceId={workspaceId} /></div>}
  </div>
}

function SupportingEvidence({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  const content = <div className="min-w-0 space-y-6">{children}</div>
  return collapsed ? <details className="min-w-0 border-y border-gray-200 py-4"><summary className="cursor-pointer text-sm font-medium">Supporting business results</summary><div className="mt-5">{content}</div></details> : content
}

function Statements({ statements }: { statements: string[] }) {
  return statements.length > 0 ? <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-gray-700">{statements.map((text, index) => <li key={index} className="break-words">{text}</li>)}</ul> : null
}

function ReportOverview({ report }: { report: BusinessReport }) {
  const single = report.definition.scope === "single"
  return <section aria-label="Report coverage" className="space-y-2 border-b border-gray-200 pb-4"><div className="flex flex-wrap items-center gap-x-5 gap-y-2"><h2 className="text-base font-semibold">{single ? report.status === "ready" ? "Dataset coverage available" : "Limited dataset coverage" : report.status === "ready" ? "Cross-dataset coverage available" : "Limited cross-dataset coverage"}</h2><span className="text-xs text-gray-500">Previous period: {report.previous_window.start} to {report.previous_window.end}</span></div>{report.source_analysis && <p className="text-xs leading-5 text-gray-600">{report.source_analysis.note} <Link href={historicalEvidenceHref(report.source_analysis.run_id)} className="text-blue-700 underline">Original analysis</Link> / {report.source_analysis.engine_version}</p>}{report.warnings.length > 0 && <div className="border-l-2 border-amber-500 pl-3"><Statements statements={report.warnings} /></div>}</section>
}
