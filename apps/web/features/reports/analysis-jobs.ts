import type { BusinessReport, ReportDefinition } from "./types"

export type AnalysisJob<T = BusinessReport> = {
  job_id: string; kind: "report" | "weekly_preview" | "weekly_send" | "weekly_owner_send" | "budget_plan"
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled"
  phase: string; error: string | null; result: T | null
  definition?: ReportDefinition | null
  created_at?: string
  retry_safe?: boolean
  weekly_settings_saved?: boolean
}

export type AnalysisRequest = <T>(path: string, init?: RequestInit) => Promise<T>

export class AnalysisUnavailableError extends Error {
  constructor(readonly status: 404 | 410) {
    super("This analysis is no longer available. It may have been deleted or expired. Choose a saved report or generate a new preview.")
    this.name = "AnalysisUnavailableError"
  }
}

export class AnalysisFailedError extends Error {
  constructor(message: string, readonly retrySafe: boolean) {
    super(message)
    this.name = "AnalysisFailedError"
  }
}

export function analysisPhaseLabel(phase: string) {
  return ({ queued: "Analysis queued", loading: "Loading selected data", computing: "Analyzing selected data",
    interpreting: "Preparing interpretation", sending: "Sending weekly report", completed: "Analysis complete",
    cancelled: "Analysis cancelled", failed: "Analysis failed" } as Record<string, string>)[phase] || "Analysis in progress"
}

function pause(signal?: AbortSignal, milliseconds = 2000) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")) }
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve() }, milliseconds)
    if (signal?.aborted) abort()
    else signal?.addEventListener("abort", abort, { once: true })
  })
}

export async function waitForAnalysis<T>(request: AnalysisRequest, identity: string, options: {
  signal?: AbortSignal; onUpdate?: (job: AnalysisJob<T>) => void
} = {}): Promise<T> {
  let failures = 0
  while (true) {
    options.signal?.throwIfAborted()
    let job: AnalysisJob<T>
    try {
      job = await request<AnalysisJob<T>>(`/jobs/${encodeURIComponent(identity)}`, { signal: options.signal })
      failures = 0
    } catch (error) {
      options.signal?.throwIfAborted()
      const status = (error as { status?: number } | null)?.status
      if (status === 429) { await pause(options.signal, 5000); continue }
      if (status === 404 || status === 410) throw new AnalysisUnavailableError(status)
      if (status === 401 || status === 403) throw error
      if (++failures >= 3) throw error
      await pause(options.signal)
      continue
    }
    options.onUpdate?.(job)
    if (job.status === "succeeded" && job.result) return job.result
    if (job.status === "failed") throw new AnalysisFailedError(job.error || analysisPhaseLabel(job.phase), job.retry_safe === true)
    if (job.status === "cancelled") throw new Error(job.error || analysisPhaseLabel(job.phase))
    await pause(options.signal)
  }
}
