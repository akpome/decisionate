"use client"

import { useEffect, useState } from "react"
import { LoaderCircle, RefreshCw } from "lucide-react"
import { correlationRequest } from "@/lib/api"
import { ReportAnomalies } from "./report-anomalies"
import type { ReportAnomalyAnalysis } from "./types"

export function DatasetReportAnomalies({ userId, workspaceId, datasetId, metric, startDate, period, aggregation, aggregationType, seasonal, refresh }: {
  userId: string; workspaceId?: string; datasetId: number; metric?: string; startDate: string; period: string
  aggregation: string; aggregationType: string; seasonal: boolean; refresh: number
}) {
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<{ key: string; analysis?: ReportAnomalyAnalysis; error?: string } | null>(null)
  const key = JSON.stringify([userId, workspaceId, datasetId, metric, startDate, period, aggregation, aggregationType, seasonal, refresh, retry])
  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ aggregation, aggregation_type: aggregationType, period_filter: period, seasonal_business: String(seasonal) })
    if (metric) params.set("metric", metric)
    if (startDate) params.set("start_date", startDate)
    void correlationRequest<ReportAnomalyAnalysis>(userId, `/business-reports/dataset-anomalies/${datasetId}?${params}`, { signal: controller.signal }, workspaceId)
      .then(analysis => { if (!controller.signal.aborted) setResult({ key, analysis }) })
      .catch(error => { if (!controller.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : "Anomaly detection is unavailable." }) })
    return () => controller.abort()
  }, [userId, workspaceId, datasetId, metric, startDate, period, aggregation, aggregationType, seasonal, key])
  if (result?.key !== key) return <section className="border-t border-gray-200 pt-5" aria-label="Anomaly detection"><h3 className="text-lg font-semibold">Anomaly detection</h3><p role="status" className="mt-3 flex items-center gap-2 text-sm text-gray-600"><LoaderCircle size={16} className="animate-spin" aria-hidden="true" />Assessing selected metrics...</p></section>
  if (result.error) return <section className="space-y-3 border-t border-gray-200 pt-5" aria-label="Anomaly detection"><h3 className="text-lg font-semibold">Anomaly detection</h3><div className="flex flex-wrap items-center gap-3"><p role="alert" className="min-w-0 break-words text-sm text-amber-800">{result.error}</p><button type="button" onClick={() => setRetry(value => value + 1)} title="Retry anomaly detection" aria-label="Retry anomaly detection" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white"><RefreshCw size={16} /></button></div></section>
  return <ReportAnomalies analysis={result.analysis} />
}
