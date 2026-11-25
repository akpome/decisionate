"use client"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { LoaderCircle, Printer } from "lucide-react"
import { API_URL } from "@/lib/api"
import { portalBrand } from "@/lib/portal-brand"
import { getWorkspaceBrandFromPayload, type WorkspaceBrand } from "@/lib/workspace-brand"
import { WorkspaceBrandMark } from "@/app/dashboard/workspace-brand-mark"
import { ReportTakeaways } from "@/features/reports/report-takeaways"
import { ReportRelationshipFindings } from "@/features/reports/report-evidence-sections"
import { ReportAnomalies } from "@/features/reports/report-anomalies"
import { ReportGrouping } from "@/features/reports/report-grouping"
import { readSharedLinkLocation } from "@/features/sharing/shared-link-location"
import type { BusinessReport } from "@/features/reports/types"

const MetricTrends = dynamic(() => import("@/features/reports/report-metric-trends").then(module => module.MetricTrends), { ssr: false })

export default function SharedReportPage() {
  const [value, setValue] = useState<{ report: BusinessReport; brand: WorkspaceBrand } | null>(null)
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const { token } = readSharedLinkLocation(window)
    const request = token
      ? fetch(`${API_URL}/public/reports/${encodeURIComponent(token)}`, { cache: "no-store", referrerPolicy: "no-referrer", signal: controller.signal,
        headers: portalBrand.id ? { "X-Application-Id": portalBrand.id } : undefined })
      : Promise.reject(new Error("This shared report is unavailable. Ask the sender for a new email."))
    request.then(async response => {
      if (!response.ok) throw new Error(response.status === 404 ? "This shared report is unavailable. Ask the sender for a new email." : "The report could not be loaded. Please try again.")
      const result = await response.json()
      if (!controller.signal.aborted) { setValue({ report: result.report, brand: getWorkspaceBrandFromPayload(result.branding) }); setError("") }
    }).catch(value => { if (!controller.signal.aborted) setError(value instanceof Error ? value.message : "Report unavailable.") })
    return () => controller.abort()
  }, [attempt])
  if (error) return <main className="mx-auto max-w-xl space-y-4 px-5 py-16"><h1 className="text-xl font-semibold">Shared report unavailable</h1><p role="alert" className="text-sm text-gray-700">{error}</p><button type="button" className="min-h-10 rounded-md border border-gray-300 px-4 py-2 text-sm" onClick={() => { setError(""); setAttempt(value => value + 1) }}>Try again</button></main>
  if (!value) return <main role="status" className="flex min-h-64 items-center justify-center gap-2"><LoaderCircle size={20} className="animate-spin" />Loading shared report...</main>
  const { report, brand } = value
  return <main className="mx-auto min-w-0 max-w-7xl space-y-6 px-4 py-6 text-gray-950 sm:px-6">
    <header className="space-y-3 border-b border-gray-200 pb-5"><div className="flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><WorkspaceBrandMark name={brand.name} logoUrl={brand.logoUrl} primaryColor={brand.primaryColor} className="h-10 w-10 rounded-md" /><span className="break-words text-sm font-medium">{brand.name}</span></div><button type="button" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gray-200 print:hidden" title="Print or save as PDF" aria-label="Print or save as PDF" onClick={() => window.print()}><Printer size={18} /></button></div>
      <p className="text-xs text-gray-500">Shared report / Read-only saved results</p><h1 className="break-words text-2xl font-semibold">{report.name}</h1><p className="break-words text-sm text-gray-700">{report.business_question}</p>
      <p className="text-xs text-gray-500">{report.window.start} to {report.window.end} / Generated {report.generated_at.slice(0, 10)}</p><ReportGrouping report={report} />
    </header>
    {report.warnings.length > 0 && <ul className="list-disc space-y-2 border-l-2 border-amber-500 pl-6 text-sm text-amber-900">{report.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
    <ReportTakeaways report={report} /><MetricTrends report={report} />
    <ReportAnomalies analysis={report.anomaly_analysis} enabled={report.definition.include_anomalies !== false} />
    <ReportRelationshipFindings report={report} />
    <section className="space-y-3 border-t border-gray-200 pt-5"><h2 className="text-lg font-semibold">Metric findings</h2><ul className="list-disc space-y-2 pl-5 text-sm">{[...report.observations, ...report.contrasts].map((text, index) => <li key={index}>{text}</li>)}</ul></section>
    <details className="space-y-3 border-t border-gray-200 py-5"><summary className="cursor-pointer text-sm font-medium">More about the evidence</summary><ul className="list-disc space-y-2 pl-5 text-sm text-gray-600">{report.limitations.map((text, index) => <li key={index}>{text}</li>)}</ul></details>
  </main>
}
