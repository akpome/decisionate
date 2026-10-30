"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { CalendarDays, ChartNoAxesCombined, FileText, LoaderCircle, Play, Printer, RefreshCw, Save, Send, Square, Trash2 } from "lucide-react"
import { correlationRequest, getMyOrganization, getOrganizationWorkspaces, type WeeklyReportDeliveryResult } from "@/lib/api"
import { defaultWorkspaceBrand, getWorkspaceBrand, type WorkspaceBrand } from "@/lib/workspace-brand"
import { WorkspaceBrandMark } from "@/app/dashboard/workspace-brand-mark"
import { useDecisionateText } from "@/app/use-decisionate-language"
import type { CatalogDataset } from "@/features/relationships/types"
import { CorrelationInsights } from "@/features/relationships/correlation-widgets"
import { getAIAnalysisProvenance } from "@/features/ai/lib/analysis-copy"
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
import { AnalysisFailedError, AnalysisUnavailableError, analysisPhaseLabel, waitForAnalysis, type AnalysisJob } from "./analysis-jobs"
import { dimensionFilterLabel } from "@/features/datasets/components/dimension-filter"
import { MAXIMUM_RELATIONSHIP_OBSERVATIONS, MINIMUM_RELATIONSHIP_OBSERVATIONS, RELATIONSHIP_DEFAULTS } from "@/features/relationships/defaults"
import { impactReady, newImpactStudy, retainedImpactStudy, type ImpactStudy } from "./impact-types"
import { ImpactBuilder } from "./impact-builder"
import { impactSetupIssue } from "./impact-builder-state"
import { ImpactResult } from "./impact-result"
import { weeklyDefinition, weeklyDeliveryIssue, type WeeklySettings } from "./weekly-settings"
import { decisionReviewDefinition, type DecisionReviewContext } from "./decision-review"
import { ImpactDecisionPicker } from "./impact-decision-picker"

const input = "mt-1 min-h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-950"
const command = "inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
const button = `${command} border-gray-300 bg-white`
const primaryButton = `${command} border-blue-700 bg-blue-700 text-white`
type SavedReport = { report_id: string; name: string; created_at: string }
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

async function loadDecisionDefinition(userId: string, workspaceId: string | undefined, current: ReportDefinition, identity: number, signal?: AbortSignal) {
  const context = await correlationRequest<DecisionReviewContext>(userId, `/business-reports/review-decisions/${identity}`, { signal }, workspaceId)
  const page = context.outcome ? await correlationRequest<{ datasets: CatalogDataset[] }>(userId,
    `/business-reports/catalog?dataset_id=${context.outcome.dataset_id}`, { signal }, workspaceId) : { datasets: [] }
  signal?.throwIfAborted()
  if (context.outcome && !page.datasets[0]?.metrics.some(metric => metric.metric_key === context.outcome!.metric_key)) {
    throw new Error("The decision's outcome metric is not available for analysis. Review its dataset metric selection before continuing.")
  }
  return { definition: decisionReviewDefinition(current, context, page.datasets[0]), datasets: page.datasets }
}

export function ReportWorkspace({ userId, workspaceId, canManage, canSave, canEditDecisions = false, initialScope = "multi", weekly = false }: {
  userId: string; workspaceId?: string; canManage: boolean; canSave: boolean; canEditDecisions?: boolean; initialScope?: "single" | "multi"; weekly?: boolean
}) {
  const { t } = useDecisionateText()
  const router = useRouter()
  const openingDraft = useRef(false)
  const analysisSubmission = useRef(false)
  const draftName = useRef("")
  const managementAction = useRef(false)
  const weeklySendRequest = useRef<string | null>(null)
  const catalogRetry = useRef(false)
  const deletedReports = useRef(new Set<string>())
  const routeController = useRef<AbortController | null>(null)
  const [datasets, setDatasets] = useState<CatalogDataset[]>([])
  const [selectedDatasetId, setSelectedDatasetId] = useState<number | null>(null)
  const [dateColumns, setDateColumns] = useState<Record<number, string>>({})
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [catalogOffset, setCatalogOffset] = useState(0)
  const [catalogSearch, setCatalogSearch] = useState("")
  const [catalogReload, setCatalogReload] = useState(0)
  const [catalogBusy, setCatalogBusy] = useState(true)
  const [catalogError, setCatalogError] = useState(false)
  const [retryingDataset, setRetryingDataset] = useState<number | null>(null)
  const [historyError, setHistoryError] = useState(false)
  const [historyReload, setHistoryReload] = useState(0)
  const [weeklySettings, setWeeklySettings] = useState<WeeklySettings | null>(null)
  const [weeklyDirty, setWeeklyDirty] = useState(false)
  const [saved, setSaved] = useState<SavedReport[]>([])
  const [definition, setDefinition] = useState<ReportDefinition>(() => weekly ? weeklyDefinition({}) : editableDefinition({ scope: initialScope }))
  const [report, setReport] = useState<BusinessReport | null>(null)
  const [view, setView] = useState<"explore" | "report">("explore")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [analysisJob, setAnalysisJob] = useState<AnalysisJob | null>(null)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [brand, setBrand] = useState<WorkspaceBrand>(defaultWorkspaceBrand)
  const request = <T,>(path: string, init: RequestInit = {}) => correlationRequest<T>(userId, `/business-reports${path}`, init, workspaceId)
  const datasetCount = new Set(definition.metrics.map(metric => metric.dataset_id)).size
  const single = definition.scope === "single"
  const singleDatasetId = single ? definition.metrics[0]?.dataset_id ?? selectedDatasetId : null
  const singleDataset = single ? datasets.find(dataset => dataset.dataset_id === singleDatasetId) : undefined
  const pagePath = weekly ? "/dashboard/reports/weekly" : single ? "/dashboard/reports/dataset" : "/dashboard/reports"
  const pageTitle = weekly ? "Weekly Business Review" : "Business Analysis"
  const setupLabel = weekly ? "Report setup" : "Build analysis"
  const previewLabel = weekly ? "Report preview" : "Analysis preview"
  const taskCount = definition.impact ? 0 : reportTestCount(definition.metrics, definition.pair_directions, definition.lag, definition.excluded_pairs)
  const showPairDirections = definition.pair_directions.length > 0
  const previewDisabled = datasetCount < (single ? 1 : 2) || single && (!singleDataset || singleDataset.catalog_status === "pending" || Boolean(singleDataset.error_code)) || !impactReady(definition.impact, definition.metrics) || Boolean(impactSetupIssue(definition, datasets)) || Boolean(definition.impact && !canEditDecisions) || taskCount > 1000 || definition.metrics.length > 25 || selectedReportDimensionFilters(definition).some(item => !item.values.length) || busy || weekly && !weeklySettings
  const weeklySendIssue = weekly && !weeklyDirty ? weeklyDeliveryIssue(report, weeklySettings?.window) : ""
  const uncertainDelivery = analysisJob?.kind === "weekly_owner_send" && analysisJob.status === "failed" && !analysisJob.retry_safe
  const deliveryNotStarted = analysisJob?.kind === "weekly_owner_send" && analysisJob.status === "failed" && analysisJob.retry_safe === true
  const previewButton = <button type="submit" className={`${primaryButton} w-full`} disabled={previewDisabled}>{busy ? <LoaderCircle size={16} className="animate-spin" /> : <Play size={16} />}{t(definition.impact ? busy ? "Checking decision..." : "Check this decision" : weekly && weeklyDirty ? "Save and preview" : weekly ? "Preview report" : "Preview analysis")}</button>

  useEffect(() => {
    const controller = new AbortController()
    const request = <T,>(path: string, init: RequestInit) => correlationRequest<T>(userId, `/business-reports${path}`, init, workspaceId)
    const timer = setTimeout(() => { void loadReportCatalogPage(request, catalogOffset, controller.signal, page => {
      setDatasets(current => mergeCatalog(current, page.datasets)); setNextOffset(page.next_offset)
    }, dataset => setDatasets(current => mergeCatalog(current, [dataset])), { metadataOnly: single, search: single ? catalogSearch : "" })
      .catch(() => { if (!controller.signal.aborted) setCatalogError(true) })
      .finally(() => { if (!controller.signal.aborted) setCatalogBusy(false) })
    }, single && catalogSearch ? 200 : 0)
    return () => { clearTimeout(timer); controller.abort() }
  }, [userId, workspaceId, catalogOffset, catalogReload, single, catalogSearch])

  useEffect(() => {
    if (!singleDataset || singleDataset.catalog_status !== "pending") return
    const controller = new AbortController()
    const request = <T,>(path: string, init: RequestInit) => correlationRequest<T>(userId, `/business-reports${path}`, init, workspaceId)
    void loadReportCatalogDataset(request, singleDataset, controller.signal)
      .then(dataset => { if (!controller.signal.aborted) setDatasets(current => mergeCatalog(current, [dataset])) })
      .catch(() => { /* A different dataset or workspace cancels this read. */ })
    return () => controller.abort()
  }, [singleDataset, userId, workspaceId])

  useEffect(() => {
    const controller = new AbortController()
    void correlationRequest<SavedReport[]>(userId, `/business-reports?workflow=${weekly ? "weekly" : "instant"}`, { signal: controller.signal }, workspaceId)
      .then(history => { if (!controller.signal.aborted) setSaved(current => [...new Map([...history, ...current].filter(item => !deletedReports.current.has(item.report_id)).map(item => [item.report_id, item])).values()]) })
      .catch(() => { if (!controller.signal.aborted) setHistoryError(true) })
    return () => controller.abort()
  }, [userId, workspaceId, historyReload, weekly])

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
        if (!weekly && params.has("weekly")) {
          router.replace(`/dashboard/reports/weekly?${params}`)
          return
        }
        let weeklyContext: WeeklySettings | null = null
        if (weekly) {
          weeklyContext = await correlationRequest<WeeklySettings>(userId, "/business-reports/weekly-settings", { signal: controller.signal }, workspaceId)
          if (!current) return
          setWeeklySettings(weeklyContext)
          const selected = weeklyDefinition(weeklyContext.definition || {}, weeklyContext.history_window)
          setDefinition(selected)
          if (weeklyContext.definition) void addSelectedDatasets(selected)
        }
        if (!params.get("report") && !params.get("weekly")) {
          if (!draftName.current) draftName.current = reportDraftName()
          setDefinition(current => ({ ...current, name: current.name || draftName.current }))
        }
        if (params.get("job")) {
          setBusy(true)
          setLoading(false)
          try {
            let restored = false
            let ownerDelivery = false
            const value = await waitForAnalysis<BusinessReport | { cross_dataset_report: BusinessReport } | WeeklyReportDeliveryResult>(
              (path, init) => correlationRequest(userId, `/business-reports${path}`, init, workspaceId),
              params.get("job")!, { signal: controller.signal, onUpdate: job => { if (current) {
                if ((job.kind !== "report") !== weekly) {
                  controller.abort()
                  router.replace(`${job.kind !== "report" ? "/dashboard/reports/weekly" : "/dashboard/reports"}?job=${job.job_id}`)
                  return
                }
                setAnalysisJob({ ...job, result: null })
                ownerDelivery = job.kind === "weekly_owner_send"
                if (job.definition && !restored) {
                  restored = true
                  setDefinition(editableDefinition(job.definition))
                  void addSelectedDatasets(job.definition)
                }
              } } },
            )
            if (!current) return
            controller.signal.throwIfAborted()
            if ("delivered_count" in value) {
              setMessage(ownerDelivery ? "Weekly report sent to the workspace owner. Scheduled delivery settings are unchanged." : "Weekly report sent.")
              window.history.replaceState(null, "", window.location.pathname)
            } else {
              const result = "cross_dataset_report" in value ? value.cross_dataset_report : value
              setReport(result); if (!weekly) setDefinition(editableDefinition(result.definition)); setView("report")
              void addSelectedDatasets(result.definition)
            }
          } catch (value) {
            if (current && !controller.signal.aborted && value instanceof AnalysisUnavailableError) {
              setAnalysisJob(null); setReport(null); setView("explore")
              window.history.replaceState(null, "", window.location.pathname)
            }
            throw value
          } finally { if (current) setBusy(false) }
        } else if (params.get("report")) {
          const result = await correlationRequest<BusinessReport>(userId, `/business-reports/${encodeURIComponent(params.get("report")!)}`, { signal: controller.signal }, workspaceId)
          if (!current) return
          if (Boolean(result.weekly_report) !== weekly) {
            router.replace(`${result.weekly_report ? "/dashboard/reports/weekly" : "/dashboard/reports"}?report=${result.report_id}`)
            return
          }
          setReport(result); if (!weekly) setDefinition(editableDefinition(result.definition)); setView("report")
          void addSelectedDatasets(result.definition)
        } else if (weekly && canManage && params.get("copy")) {
          const source = await correlationRequest<BusinessReport>(userId, `/business-reports/${encodeURIComponent(params.get("copy")!)}`, { signal: controller.signal }, workspaceId)
          if (!current) return
          const copied = weeklyDefinition({ ...source.definition, name: `Weekly ${source.name}`.slice(0, 120) }, weeklyContext?.history_window)
          setDefinition(copied); setWeeklyDirty(true)
          void addSelectedDatasets(copied)
          setMessage("Selection copied. Check the weekly settings before saving. Instant-analysis dates and non-weekly lags were not copied.")
        } else if (params.get("weekly")) {
          const request = <T,>(path: string, init: RequestInit = {}) => correlationRequest<T>(userId, `/business-reports${path}`, { ...init, signal: controller.signal }, workspaceId)
          const job = await request<AnalysisJob>("/weekly-jobs?include_ai_analysis=true", { method: "POST" })
          if (!current) return
          setAnalysisJob(job); setBusy(true); setLoading(false)
          window.history.replaceState(null, "", `${window.location.pathname}?job=${encodeURIComponent(job.job_id)}`)
          const result = await waitForAnalysis<BusinessReport>(request, job.job_id, { signal: controller.signal, onUpdate: value => { if (current) setAnalysisJob(value) } })
          if (!current) return
          setReport(result); setView("report")
          void addSelectedDatasets(result.definition)
        } else if (params.get("decision")) {
          const identity = Number(params.get("decision"))
          if (!Number.isSafeInteger(identity) || identity < 1) throw new Error("Choose a valid existing decision.")
          const chosen = await loadDecisionDefinition(userId, workspaceId,
            weekly ? weeklyDefinition(weeklyContext?.definition || {}) : editableDefinition({ scope: "multi", name: draftName.current }), identity, controller.signal)
          if (!current) return
          const selected = weekly ? weeklyDefinition(chosen.definition, weeklyContext?.history_window) : chosen.definition
          setDefinition(selected); setDatasets(existing => mergeCatalog(existing, chosen.datasets))
          if (weekly) setWeeklyDirty(true)
          void addSelectedDatasets(selected)
        } else if (!weekly && params.get("run")) {
          const result = await correlationRequest<ReportDefinition>(userId, `/business-reports/from-run/${encodeURIComponent(params.get("run")!)}`, { signal: controller.signal }, workspaceId)
          if (!current) return
          setDefinition(editableDefinition({ ...result, name: draftName.current }))
          void addSelectedDatasets(result)
        } else if (!weekly && params.get("dataset")) {
          const identity = Number(params.get("dataset"))
          if (Number.isSafeInteger(identity) && identity > 0) {
            const selectedDataset = await correlationRequest<{ datasets: CatalogDataset[] }>(userId, `/business-reports/catalog?dataset_id=${identity}`, { signal: controller.signal }, workspaceId)
            if (!current) return
            setSelectedDatasetId(identity)
            setDatasets(existing => mergeCatalog(existing, selectedDataset.datasets))
            const dataset = selectedDataset.datasets[0]
            const metric = dataset?.metrics.find(item => item.metric_key === params.get("metric")) || dataset?.metrics[0]
            const dateColumn = dataset && reportDateColumn(dataset, [], {})
            if (metric && dateColumn) {
              setDefinition(current => editableDefinition({ ...current, metrics: [{ dataset_id: identity, metric_key: metric.metric_key, date_column: dateColumn, aggregation: metric.aggregation }], date_range: dataset.availability[dateColumn] }))
            }
          }
        }
      } catch (value) { if (current && !controller.signal.aborted) setError(errorMessage(value)) }
      finally { if (current) { setLoading(false); setBusy(false) } }
      try {
        const organization = await getMyOrganization(userId)
        const workspaces = await getOrganizationWorkspaces(userId)
        if (current) setBrand(getWorkspaceBrand(workspaceId || userId, userId, organization, workspaces, undefined))
      } catch { /* Optional branding must not prevent analysis. */ }
    }
    void load()
    return () => { current = false; controller.abort() }
  }, [userId, workspaceId, weekly, router, canManage])

  function refreshCatalog() {
    if (catalogBusy || catalogRetry.current) return
    setCatalogBusy(true); setCatalogError(false)
    if (singleDataset) setDatasets(current => current.map(dataset => dataset.dataset_id === singleDataset.dataset_id ? { ...dataset, catalog_status: "pending" } : dataset))
    setCatalogOffset(0); setCatalogReload(value => value + 1)
  }

  function chooseSingleDataset(identity: number | null) {
    if (!single || busy || identity === singleDatasetId || identity !== null && !datasets.some(dataset => dataset.dataset_id === identity)) return
    setSelectedDatasetId(identity)
    setDateColumns({})
    edit({ metrics: [], dimension_filters: [], date_range: { start: "", end: "" }, source_run_id: null })
  }

  function searchSingleDatasets(search: string) {
    if (!single || search === catalogSearch) return
    setCatalogBusy(true); setCatalogError(false); setNextOffset(null); setCatalogOffset(0); setCatalogSearch(search)
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
    if (weekly && !canManage) return
    if (weekly) setWeeklyDirty(true)
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
    if (definition.impact) edit({ impact: { ...definition.impact, ...patch, ...("change_date" in patch ? { comparison_unaffected: false } : {}) } })
  }

  async function chooseReviewDecision(identity: number) {
    if (!canEditDecisions || busy || managementAction.current) return
    managementAction.current = true
    try {
      await execute(async () => {
        const chosen = await loadDecisionDefinition(userId, workspaceId, definition, identity, routeController.current?.signal)
        const selected = weekly ? weeklyDefinition(chosen.definition, weeklySettings?.history_window) : chosen.definition
        setDatasets(existing => mergeCatalog(existing, chosen.datasets))
        edit(selected)
        window.history.replaceState(null, "", `${pagePath}?decision=${identity}`)
        const signal = routeController.current?.signal
        if (signal) void hydrateCatalog(userId, workspaceId, chosen.datasets, selected, signal)
          .then(hydrated => { if (!signal.aborted) setDatasets(existing => mergeCatalog(existing, hydrated)) })
          .catch(() => { if (!signal.aborted) setCatalogError(true) })
      })
    } finally { managementAction.current = false }
  }

  function toggleMetric(dataset: CatalogDataset, key: string) {
    if (single && dataset.dataset_id !== singleDatasetId) return
    const metric = dataset.metrics.find(item => item.metric_key === key)
    if (!metric) return
    if (single) setSelectedDatasetId(dataset.dataset_id)
    const existing = definition.metrics.find(item => item.dataset_id === dataset.dataset_id && item.metric_key === key)
    if (existing && definition.impact?.decision_id && definition.impact.outcome?.dataset_id === dataset.dataset_id && definition.impact.outcome.metric_key === key) return
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
    } finally { setBusy(false) }
  }

  async function calculate() {
    if (analysisSubmission.current || busy) return
    analysisSubmission.current = true
    try { await execute(async () => {
      const signal = routeController.current?.signal
      if (weekly && weeklyDirty) await persistWeeklySettings()
      const job = await request<AnalysisJob>(weekly ? "/weekly-jobs?include_ai_analysis=true" : "/jobs", { method: "POST", signal, headers: { "Idempotency-Key": crypto.randomUUID() }, ...(!weekly ? { body: JSON.stringify({ ...definition, dimension_filters: selectedReportDimensionFilters(definition), included_findings: null }) } : {}) })
      signal?.throwIfAborted()
      setAnalysisJob(job)
      window.history.replaceState(null, "", `${window.location.pathname}?job=${encodeURIComponent(job.job_id)}`)
      const result = await waitForAnalysis<BusinessReport>(request, job.job_id, { signal, onUpdate: setAnalysisJob })
      signal?.throwIfAborted()
      if (!weekly) setDefinition(editableDefinition(result.definition))
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
    window.history.replaceState(null, "", `${pagePath}?report=${result.report_id}`)
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
          const query = new URLSearchParams({ report: snapshot.report_id!, returnTo: `${pagePath}?report=${snapshot.report_id}` })
          router.push(`/dashboard/decisions/new?${query}`)
          return
        }
        const result = await request<{ decision_id: number }>(`/${snapshot.report_id}/decision-drafts/${decisionId}/evidence`, { method: "POST" })
        router.push(`/dashboard/decisions/${result.decision_id}`)
      })
    } finally { openingDraft.current = false }
  }

  async function persistWeeklySettings() {
    if (!weekly || !canManage) throw new Error("Only workspace managers can change weekly report settings.")
    const result = await request<WeeklySettings>("/weekly-settings", { method: "PUT", signal: routeController.current?.signal,
      body: JSON.stringify({ ...weeklyDefinition(definition, weeklySettings?.history_window), dimension_filters: selectedReportDimensionFilters(definition) }) })
    setWeeklySettings(result); setWeeklyDirty(false)
    if (new URLSearchParams(window.location.search).has("copy")) window.history.replaceState(null, "", pagePath)
    return result
  }

  async function saveWeeklySettings() {
    if (!weekly || !canManage || busy || managementAction.current) return
    managementAction.current = true
    try {
      await execute(async () => {
        await persistWeeklySettings()
        setMessage("Weekly settings saved. Recipients and delivery preferences are unchanged.")
      })
    } finally { managementAction.current = false }
  }

  async function sendWeeklyNow() {
    if (!weekly || !canManage || busy || previewDisabled || weeklySendIssue || uncertainDelivery || managementAction.current) return
    managementAction.current = true
    try {
      await execute(async () => {
        if (weeklyDirty) {
          await persistWeeklySettings()
          weeklySendRequest.current = null
        }
        weeklySendRequest.current ||= crypto.randomUUID()
        const signal = routeController.current?.signal
        const returnUrl = report?.report_id ? `${pagePath}?report=${encodeURIComponent(report.report_id)}`
          : report?.analysis_job_id ? `${pagePath}?job=${encodeURIComponent(report.analysis_job_id)}` : pagePath
        const job = await request<AnalysisJob<WeeklyReportDeliveryResult>>("/weekly-owner-jobs?include_ai_analysis=true", {
          method: "POST", signal, headers: { "Idempotency-Key": weeklySendRequest.current },
        })
        signal?.throwIfAborted()
        setAnalysisJob({ ...job, result: null })
        window.history.replaceState(null, "", `${pagePath}?job=${encodeURIComponent(job.job_id)}`)
        try {
          await waitForAnalysis<WeeklyReportDeliveryResult>(request, job.job_id, {
            signal, onUpdate: value => setAnalysisJob({ ...value, result: null }),
          })
        } catch (value) {
          if (value instanceof AnalysisFailedError && value.retrySafe) weeklySendRequest.current = null
          throw value
        }
        signal?.throwIfAborted()
        weeklySendRequest.current = null
        window.history.replaceState(null, "", returnUrl)
        setMessage("Weekly report sent to the workspace owner. Scheduled delivery settings are unchanged.")
      })
    } finally { managementAction.current = false }
  }

  async function deleteSavedReport() {
    const identity = report?.report_id
    if (!identity || !canManage || busy || managementAction.current) return
    if (!window.confirm(`${t("Delete saved report")}: "${report.name}"?\n${t("Linked decisions, datasets and independent weekly settings will be kept.")}`)) return
    managementAction.current = true
    try {
      await execute(async () => {
        const result = await request<{ weekly_template_removed: boolean }>(`/${encodeURIComponent(identity)}`, { method: "DELETE" })
        deletedReports.current.add(identity)
        setSaved(current => current.filter(item => item.report_id !== identity))
        setReport(null); setAnalysisJob(null); setView("explore")
        window.history.replaceState(null, "", pagePath)
        setMessage(result.weekly_template_removed ? "Saved report deleted and weekly delivery paused. Linked decisions and datasets were kept." : "Saved report deleted. Linked decisions and datasets were kept.")
      })
    } finally { managementAction.current = false }
  }

  async function removeWeeklySettings() {
    if (!weekly || !canManage || busy || managementAction.current) return
    if (!window.confirm(t("Remove weekly settings and pause delivery? Saved snapshots and linked decisions will be kept."))) return
    managementAction.current = true
    try {
      await execute(async () => {
        const result = await request<WeeklySettings>("/weekly-settings", { method: "DELETE" })
        setWeeklySettings(result); setWeeklyDirty(false)
        setDefinition(weeklyDefinition({ name: defaultReportName() }, result.history_window))
        setReport(null); setAnalysisJob(null); setView("explore")
        window.history.replaceState(null, "", pagePath)
        setMessage("Weekly settings removed and delivery paused. Saved snapshots and linked decisions were kept.")
      })
    } finally { managementAction.current = false }
  }

  const reportDetails = <div className="grid min-w-0 gap-4 md:grid-cols-2">
    <div className="min-w-0"><label htmlFor="report-name" className="block text-xs font-medium text-gray-700">Report name</label><input id="report-name" aria-describedby="report-name-hint" className={input} required maxLength={120} value={definition.name} onChange={event => edit({ name: event.target.value })} /><p id="report-name-hint" className="mt-1 text-xs text-gray-500">{t("Edit this report name to suit your analysis.")}</p></div>
    <label className="block text-xs font-medium text-gray-700">Business question<input className={input} required minLength={8} maxLength={1000} value={definition.business_question} onChange={event => edit({ business_question: event.target.value })} /></label>
  </div>
  const catalogFooter = nextOffset !== null && <button type="button" className={button} disabled={busy || catalogBusy || retryingDataset !== null} onClick={() => { setCatalogBusy(true); setCatalogError(false); setCatalogOffset(nextOffset) }}>Load more datasets</button>
  const weeklySaveButton = weekly && canManage && <button type="button" className={`${button} w-full`} disabled={previewDisabled || !weeklyDirty} onClick={event => { if (event.currentTarget.form?.reportValidity()) void saveWeeklySettings() }}><Save size={16} />Save weekly settings</button>
  if (loading) return <div className="min-w-0 w-full space-y-5"><h1 className="text-2xl font-semibold">{t(pageTitle)}</h1><p role="status" className="py-8 text-sm text-gray-600">{t(weekly ? "Loading weekly review..." : "Loading business analysis...")}</p></div>
  return <div className="min-w-0 w-full space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-4 print:hidden">
      <h1 className="text-2xl font-semibold">{t(pageTitle)}</h1>
      <div role="tablist" aria-label={t(weekly ? "Weekly review workspace" : "Business analysis workspace")} className="flex w-full min-w-0 gap-1 rounded-md border border-gray-200 bg-white p-1 sm:w-auto">
        {(["explore", "report"] as const).map(mode => <button key={mode} type="button" role="tab" tabIndex={view === mode ? 0 : -1} aria-selected={view === mode} aria-controls={`report-${mode}`} id={`tab-${mode}`} onClick={() => setView(mode)} onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
          event.preventDefault()
          const next = event.key === "Home" ? "explore" : event.key === "End" ? "report" : mode === "explore" ? "report" : "explore"
          setView(next); document.getElementById(`tab-${next}`)?.focus()
        }} className={`inline-flex min-h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded px-3 text-sm sm:flex-none ${view === mode ? "bg-blue-50 font-semibold text-blue-800" : "text-gray-600"}`}>{mode === "explore" ? <ChartNoAxesCombined size={16} aria-hidden="true" className="shrink-0" /> : <FileText size={16} aria-hidden="true" className="shrink-0" />}<span className="min-w-0 break-words">{t(mode === "explore" ? setupLabel : previewLabel)}</span></button>)}
      </div>
    </header>
    {!weekly && <nav aria-label="Analysis sources" className="flex flex-wrap gap-4 text-sm print:hidden">{[{ scope: "multi", href: "/dashboard/reports", label: "Multi dataset report" }, { scope: "single", href: "/dashboard/reports/dataset", label: "Single dataset report" }].map(item => <Link key={item.scope} href={item.href} aria-current={definition.scope === item.scope ? "page" : undefined} className={definition.scope === item.scope ? "font-semibold text-blue-800 underline underline-offset-8" : "text-gray-600"}>{t(item.label)}</Link>)}</nav>}
    {error && <p role="alert" className="break-words rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {weekly && !weeklySettings && <button type="button" className={button} onClick={() => window.location.reload()}><RefreshCw size={16} />Retry weekly settings</button>}
    {message && <p role="status" className="text-sm text-green-800">{t(message)}</p>}
    {analysisJob && ["queued", "running"].includes(analysisJob.status) && <div className="flex flex-wrap items-center justify-between gap-3 border-y border-gray-200 py-3 print:hidden">
      <p role="status" className="flex items-center gap-2 text-sm"><LoaderCircle size={16} className="shrink-0 animate-spin" />{t(analysisPhaseLabel(analysisJob.phase))}</p>
      {!busy && <button type="button" className={button} onClick={() => window.location.reload()}><RefreshCw size={16} />{t("Reconnect")}</button>}
      <button type="button" className={button} disabled={["weekly_send", "weekly_owner_send"].includes(analysisJob.kind) && analysisJob.phase === "sending"} onClick={() => void request<AnalysisJob>(`/jobs/${encodeURIComponent(analysisJob.job_id)}/cancel`, { method: "POST" }).then(setAnalysisJob).catch(value => setError(errorMessage(value)))}><Square size={14} />{t("Cancel analysis")}</button>
    </div>}
    <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
      <div className="flex w-full max-w-md items-end gap-2"><label className="block min-w-0 flex-1 text-xs text-gray-600">Saved reports<select className={input} disabled={busy} value={report?.report_id || ""} onChange={event => {
        const id = event.target.value
        if (!id) return
        void execute(async () => {
          const result = await request<BusinessReport>(`/${id}`)
          setReport(result); if (!weekly) setDefinition(editableDefinition(result.definition)); setDateColumns({}); setView("report")
          window.history.replaceState(null, "", `${pagePath}?report=${id}`)
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
          <button type="button" className={button} disabled={busy || !canSave || Boolean(report.report_id) || Boolean(report.definition.impact?.decision_id && !canEditDecisions)} onClick={() => void execute(async () => { const saved = await saveSnapshot(); setMessage(saved.decision_review_id ? "Assessment saved to the existing decision. Its recorded outcome and lessons are unchanged." : "Report snapshot saved.") })}><Save size={16} />{report.definition.impact?.decision_id ? "Save assessment to decision" : "Save snapshot"}</button>
          {report.definition.impact?.decision_id && <Link className={button} href={`/dashboard/decisions/${report.definition.impact.decision_id}#business-impact-review`}>Return to decision</Link>}
          {!single && !weekly && canManage && report.report_id && <Link href={`/dashboard/reports/weekly?copy=${encodeURIComponent(report.report_id)}`} className={button}><CalendarDays size={16} />{t("Copy selection to Weekly Review")}</Link>}
          {view === "report" && <button type="button" className={button} title="Print or save as PDF" aria-label="Print or save as PDF" onClick={() => window.print()}><Printer size={17} /></button>}
        </>}
        {weekly && canManage && <button type="button" className={button} disabled={previewDisabled || Boolean(weeklySendIssue) || uncertainDelivery} title="Email the current weekly report to the workspace owner" onClick={() => void sendWeeklyNow()}><Send size={16} />Send report now</button>}
        {weekly && <Link href="/dashboard/alerts#weekly-delivery" className={button}><CalendarDays size={16} />Delivery settings</Link>}
      </div>
    </div>
    {historyError && <div className="flex flex-wrap items-center gap-3 text-sm text-amber-900"><p role="alert">{t("Saved reports could not be loaded.")}</p><button type="button" className={button} onClick={() => { setHistoryError(false); setHistoryReload(value => value + 1) }}><RefreshCw size={16} />{t("Retry")}</button></div>}
    {weekly && <section aria-label="Weekly settings status" className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-4 print:hidden">
      <p className="text-sm text-gray-600">{weeklyDirty ? "Unsaved weekly settings" : weeklySettings?.definition ? "Weekly settings saved" : "No weekly settings saved"} / {weeklySettings?.enabled ? "Delivery enabled" : "Delivery paused"}</p>
      {canManage && weeklySettings?.definition && <button type="button" className={`${button} text-red-700`} disabled={busy} title="Remove weekly settings" aria-label="Remove weekly settings" onClick={() => void removeWeeklySettings()}><Trash2 size={16} /></button>}
    </section>}
    {weeklySendIssue && <p role="status" className="border-l-2 border-amber-500 pl-3 text-sm leading-6 text-amber-900">{weeklySendIssue}</p>}
    {uncertainDelivery && <p role="status" className="text-sm leading-6 text-amber-900">Delivery could not be confirmed. Check <Link href="/dashboard/alerts#weekly-delivery" className="text-blue-700 underline">delivery history</Link> before attempting another send.</p>}
    {deliveryNotStarted && <p role="status" className="text-sm leading-6 text-amber-900">Report preparation stopped before email delivery started. No email was sent. Generate a new preview, then try sending again.</p>}

    <section role="tabpanel" id="report-explore" aria-labelledby="tab-explore" hidden={view !== "explore"} className="space-y-6 print:hidden">
      <form onSubmit={event => { event.preventDefault(); void calculate() }}>
        <fieldset disabled={busy || weekly && !canManage || weekly && !weeklySettings} className="min-w-0 space-y-5">
          {!single && <fieldset className="min-w-0"><legend className="mb-2 text-sm font-medium">Analysis type</legend><div className="inline-flex max-w-full flex-wrap gap-1 rounded-md border border-gray-200 bg-white p-1" role="group" aria-label="Analysis type">
            {[{ label: "Correlation analysis", impact: false }, { label: "Business impact analysis", impact: true }].map(mode => <button key={mode.label} type="button" aria-pressed={Boolean(definition.impact) === mode.impact} className={`min-h-10 min-w-0 rounded px-3 text-sm ${Boolean(definition.impact) === mode.impact ? "bg-blue-50 font-semibold text-blue-800" : "text-gray-600"}`} onClick={() => {
              if (Boolean(definition.impact) !== mode.impact) edit({ impact: mode.impact ? newImpactStudy() : null, ...(mode.impact && definition.grain === "quarterly" ? { grain: "weekly" } : {}) })
            }}>{mode.label}</button>)}
          </div></fieldset>}
          {definition.impact ? <ImpactBuilder definition={definition} datasets={datasets} userId={userId} workspaceId={workspaceId} weekly={weekly} weeklySettings={weeklySettings}
            decisionPicker={<ImpactDecisionPicker key={JSON.stringify([userId, workspaceId])} userId={userId} workspaceId={workspaceId} decisionId={definition.impact.decision_id} disabled={!canEditDecisions || busy} onChoose={identity => void chooseReviewDecision(identity)} />}
            reportDetails={reportDetails} actions={<>{previewButton}{weeklySaveButton}</>} loading={catalogBusy} catalogError={catalogError} retryingDataset={retryingDataset} footer={catalogFooter}
            onChange={edit} onStudyChange={editImpact} onRetry={refreshCatalog} onRetryDataset={dataset => void retryDataset(dataset)} /> : <>
          {reportDetails}
          <div className="grid min-w-0 items-start gap-6 border-y border-gray-200 py-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <ReportMetricPicker key={single ? `single-${singleDatasetId ?? "none"}` : "multi"} userId={userId} workspaceId={workspaceId} selectedDatasetId={singleDatasetId} onDatasetChange={chooseSingleDataset} onDatasetSearch={searchSingleDatasets} selectionDisabled={busy} dimensionFilters={definition.dimension_filters} onDimensionFilterChange={(identity, filter) => edit({ dimension_filters: [
              ...(definition.dimension_filters || []).filter(item => item.dataset_id !== identity), ...(filter ? [{ dataset_id: identity, ...filter }] : []),
            ] })} datasets={datasets} metrics={definition.metrics} dateColumns={dateColumns} singleDataset={single} loading={catalogBusy} error={catalogError} onRetry={refreshCatalog} onRetryDataset={dataset => void retryDataset(dataset)} retryingDataset={retryingDataset} onToggleMetric={toggleMetric} onDateColumnChange={(dataset, column) => {
              setDateColumns(current => ({ ...current, [dataset.dataset_id]: column }))
              edit({ metrics: definition.metrics.map(item => item.dataset_id === dataset.dataset_id ? { ...item, date_column: column } : item) })
            }} footer={catalogFooter} />
            <section className="report-builder-section gap-4" aria-label="Analysis settings">
              <h2 className="shrink-0 text-base font-semibold">{weekly ? "Weekly settings" : "Analysis settings"}</h2>
              {weekly ? <div className="shrink-0 space-y-2 text-sm"><p className="font-medium">Last completed week</p><p>{weeklySettings?.window.start} to {weeklySettings?.window.end}</p><p className="text-xs text-gray-500">Monday-Sunday / {weeklySettings?.reporting_timezone}</p></div> : <div className="grid shrink-0 grid-cols-2 gap-3"><label className="block text-xs text-gray-600">Start<input className={input} type="date" required max={definition.date_range.end || undefined} value={definition.date_range.start} onChange={event => edit({ date_range: { ...definition.date_range, start: event.target.value } })} /></label><label className="block text-xs text-gray-600">End<input className={input} type="date" required min={definition.date_range.start || undefined} value={definition.date_range.end} onChange={event => edit({ date_range: { ...definition.date_range, end: event.target.value } })} /></label></div>}
              <div role="group" aria-label="Analysis settings" tabIndex={0} className="report-builder-scroll space-y-4 pr-2 focus-visible:outline-2 focus-visible:outline-blue-600">
                {weekly ? <div className="space-y-2 border-b border-gray-100 pb-3 text-xs text-gray-600"><p className="text-sm font-medium text-gray-950">Report week: daily detail</p><p>Earlier history: grouped weekly.</p><p>Historical window: {weeklySettings?.history_window.start} to {weeklySettings?.history_window.end} (up to 3 years).</p></div> : <label className="block text-xs text-gray-600">Analysis group by<select className={input} value={definition.grain} onChange={event => edit({ grain: event.target.value })}>{["daily", "weekly", "monthly", "quarterly"].map(value => <option key={value}>{value}</option>)}</select></label>}
                <label className="flex items-start gap-2 text-sm"><input className="mt-0.5 h-4 w-4 shrink-0" type="checkbox" checked={definition.seasonal_business} onChange={event => edit({ seasonal_business: event.target.checked })} />{t("Business has seasonal activity")}</label>
                {!single && !definition.impact && <section aria-label="Relationship analysis" className="border-y border-gray-100 py-3"><h3 className="text-sm font-medium">{t("Relationship analysis")}</h3><div className="mt-3 space-y-3">
                  <label className="block text-xs text-gray-600">Correlation method<select className={input} value={definition.method} onChange={event => edit({ method: event.target.value as ReportDefinition["method"] })}><option value="spearman">Spearman</option><option value="pearson">Pearson</option></select></label>
                  <label className="block text-xs text-gray-600">{weekly ? "Minimum matched weeks" : "Minimum historical observations"}<input className={input} type="number" min={MINIMUM_RELATIONSHIP_OBSERVATIONS} max={MAXIMUM_RELATIONSHIP_OBSERVATIONS} required value={definition.filters.minimum_observations} onChange={event => edit({ filters: { ...definition.filters, minimum_observations: Number(event.target.value) } })} /></label>
                  <section aria-label={t("Evaluate timing")} className="space-y-3"><h4 className="text-sm font-medium">{t("Evaluate timing")}</h4><label className="block text-xs text-gray-600">{weekly ? "Maximum lag (weeks)" : "Maximum lag"}<input className={input} type="number" min={definition.lag.minimum} max={RELATIONSHIP_DEFAULTS.maximumLag} required value={definition.lag.maximum} onChange={event => edit({ lag: { ...definition.lag, maximum: Number(event.target.value) } })} /></label></section>
                  {showPairDirections && <ReportPairDirections pairs={definition.pair_directions} excludedPairs={definition.excluded_pairs} datasets={datasets}
                    onChange={(pair, direction) => edit({ pair_directions: definition.pair_directions.map(item => reportPairKey(item) === reportPairKey(pair) ? { ...item, direction } : item) })}
                    onRemove={pair => edit({ excluded_pairs: [...definition.excluded_pairs, pair] })}
                    onRestore={pair => edit({ excluded_pairs: definition.excluded_pairs.filter(item => unorderedReportPairKey(item) !== unorderedReportPairKey(pair)) })} />}
                </div></section>}
              </div>
              <p className="shrink-0 text-sm text-gray-600">{definition.metrics.length} metrics / {datasetCount} datasets{!definition.impact && <> / {taskCount} tests</>}</p>
              {taskCount > 1000 && <p className="shrink-0 text-sm text-amber-800">Report analysis exceeds the 1,000-test limit.</p>}
              {previewButton}
              {weeklySaveButton}
            </section>
          </div></>}
        </fieldset>
        {weekly && !canManage && <button type="submit" className={primaryButton} disabled={previewDisabled}><Play size={16} />Preview weekly report</button>}
      </form>
    </section>

    <section role="tabpanel" id="report-report" aria-labelledby="tab-report" hidden={view !== "report"} className="space-y-6">
      {view !== "report" ? null : !report ? <div className="border-y border-gray-200 py-12 text-center"><FileText className="mx-auto text-gray-400" size={32} /><h2 className="mt-3 text-lg font-medium">{t(weekly ? "No report generated" : "No analysis generated")}</h2><button type="button" className={`${button} mt-4`} onClick={() => setView("explore")}><ChartNoAxesCombined size={16} />{t(setupLabel)}</button></div> : <>
        <header className="border-b border-gray-200 pb-5"><div className="flex items-center gap-3"><WorkspaceBrandMark name={brand.name} logoUrl={brand.logoUrl} primaryColor={brand.primaryColor} className="h-10 w-10 rounded-md text-sm" /><span className="text-sm font-medium">{brand.name}</span></div><h2 className="mt-4 break-words text-2xl font-semibold">{report.name}</h2><p className="mt-2 break-words text-base text-gray-700">{report.business_question}</p><p className="mt-2 text-xs text-gray-500">{report.window.start} to {report.window.end} / {report.dataset_count} datasets / Generated {report.generated_at.slice(0, 10)}</p><ReportGrouping report={report} /></header>
        <ImpactResult analysis={report.impact_analysis} />
        {report.impact_analysis && <ImpactChart analysis={report.impact_analysis} />}
        <SupportingEvidence collapsed={Boolean(report.impact_analysis)}>
        <ReportOverview report={report} />
        {(report.definition.dimension_filters || []).map(selection => <p key={selection.dataset_id} className="break-words text-sm text-gray-600"><span className="font-medium">{report.metrics.find(metric => metric.dataset_id === selection.dataset_id)?.dataset_label || `Dataset ${selection.dataset_id}`}</span> / {dimensionFilterLabel(selection)}</p>)}
        {report.ai_analysis && <section aria-label="Report interpretation" className="space-y-3 border-b border-gray-200 pb-5"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-lg font-semibold">{t("Report interpretation")}</h3><span className="text-xs text-gray-500">{report.ai_analysis.confidence} confidence</span></div><p className="text-xs text-gray-500">{getAIAnalysisProvenance(report.ai_analysis)}</p><p className="break-words text-sm leading-6 text-gray-700">{report.ai_analysis.summary}</p><Statements statements={report.ai_analysis.recommendations} /><Statements statements={report.ai_analysis.risks} /></section>}
        <MetricTrends report={report} />
        {report.weekly_anomaly_analysis && <ReportAnomalies analysis={report.weekly_anomaly_analysis} title="Whole-week assessment" />}
        <ReportAnomalies analysis={report.anomaly_analysis} title={report.weekly_anomaly_analysis ? "Daily changes" : "Anomaly detection"} />
        <section aria-label="Analysis findings" className="space-y-3 border-t border-gray-200 pt-5"><h3 className="text-lg font-semibold">{single ? "Metric findings" : "What changed across your business"}</h3>{report.observations.length + report.contrasts.length === 0 && <p className="text-sm text-gray-500">There is no complete earlier period to compare these totals with. {report.definition.impact || report.impact_analysis ? "The business impact assessment uses its own before-and-after checks." : "The relationship and business-change results below are checked separately."}</p>}<Statements statements={report.observations} /><Statements statements={report.contrasts} /></section>
        {!single && <ReportRelationshipFindings report={report} />}
        {!report.impact_analysis && <section className="space-y-3 border-t border-gray-200 pt-5"><h3 className="text-lg font-semibold">Follow-up actions</h3><Statements statements={report.recommendations} /></section>}
        <details className="space-y-2 border-t border-gray-200 pt-5"><summary className="cursor-pointer text-sm font-medium">More about the evidence</summary><p className="text-xs text-gray-500">Calculated from your selected data{!single && !report.definition.impact && !report.impact_analysis && <> / Earlier relationships: {report.history_window.start} to {report.history_window.end}</>}</p><Statements statements={report.impact_analysis?.limitations || report.limitations} /></details>
        </SupportingEvidence>
        <ReportDecisions report={report} onOpenDraft={canEditDecisions && canSave ? openDecisionDraft : undefined} busy={busy} />
      </>}
    </section>
    {!single && !weekly && !definition.impact && <div className="print:hidden"><CorrelationInsights key={`${userId}:${workspaceId}`} userId={userId} workspaceId={workspaceId} /></div>}
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
