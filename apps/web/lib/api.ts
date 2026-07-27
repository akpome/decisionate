import {
  getActiveWorkspaceId,
  notifyWorkspaceAccessChanged,
} from "@/lib/workspace-context"
import {
  dashboardUsesDatasetMetricMapping,
  defaultDashboardKey,
  getDashboardDefinition,
  isDashboardKey,
} from "@/features/dashboards/dashboard-definitions"

const configuredApiUrl =
  process.env.NEXT_PUBLIC_API_URL
    ?.trim()
    .replace(/\/$/, "")

export const API_URL =
  configuredApiUrl || "http://localhost:8000"
export const apiAvailabilityChangedEvent =
  "decisionate:api-availability-changed"
const maxDashboardTitleLength = 120
const maxDashboardSubtitleLength = 220
const maxDashboardChartTitleLength = 80
const datasetPreferenceWriteQueues =
  new Map<string, Promise<void>>()

type ApiErrorBody = {
  detail?: string | {
    msg?: string
  }[]
  message?: string
}

async function readApiErrorMessage(
  response: Response,
  fallbackMessage: string
) {
  try {
    const body =
      (await response.json()) as ApiErrorBody

    if (typeof body.detail === "string") {
      return body.detail
    }

    if (Array.isArray(body.detail)) {
      const messages = body.detail
        .map((item) => item.msg)
        .filter(Boolean)

      if (messages.length > 0) {
        return messages.join(", ")
      }
    }

    if (body.message) {
      return body.message
    }
  } catch {
    return fallbackMessage
  }

  return fallbackMessage
}

export type DecisionListLifecycle =
  | "all"
  | "active"
  | "archived"

export type DecisionListSort =
  | "created_desc"
  | "created_asc"
  | "updated_desc"
  | "review_asc"
  | "review_desc"

export type DecisionOutcomeWorkflowState =
  | "planned"
  | "pending"
  | "recorded"
  | "evaluated"

export type DecisionAttentionWorkflowState =
  | "required"

export type DecisionLearningWorkflowState =
  | "captured"
  | "pending"

export type DecisionNotesWorkflowState =
  | "added"
  | "pending"

export type DecisionReviewWorkflowState =
  | "scheduled"
  | "overdue"
  | "upcoming"

export type DecisionListOptions = {
  status?: DecisionStatus
  category?: DecisionCategory
  attentionState?: DecisionAttentionWorkflowState
  outcomeState?: DecisionOutcomeWorkflowState
  learningState?: DecisionLearningWorkflowState
  notesState?: DecisionNotesWorkflowState
  reviewState?: DecisionReviewWorkflowState
  lifecycle?: DecisionListLifecycle
  search?: string
  sort?: DecisionListSort
  limit?: number
  offset?: number
}

export type DatasetAnalyticsManifest = {
  engine: string
  storage_format: string
  workspace_namespace: string
  table_name: string
  parquet_path: string
  bigquery_table_id?: string | null
}

export type AnalyticsEngineStatus = {
  engine: string
  storage_format: string
  portable_storage: boolean
  duckdb_configured: boolean
  bigquery_configured: boolean
  bigquery_location?: string | null
}

export type DatasetSummary = {
  id: number
  workspace_id?: string | null
  source_type?: string | null
  source_label?: string | null
  source_config?: string | null
  file_name: string
  row_count: number
  column_count: number
  analytics?: DatasetAnalyticsManifest
  created_at?: string
}

export type DatasetMetricSummary = {
  column: string
  total?: number
  average?: number
  min?: number
  max?: number
  minimum?: number
  maximum?: number
}

export type DatasetMetricsResponse = {
  dataset_id: number
  file_name: string
  metrics: DatasetMetricSummary[]
}

export type DatasetAIAnalysisResponse = {
  dataset_id: number
  metric?: string | null
  ai_analysis: AIAnalysis
}

export type DatasetSourceStatus =
  | "available"
  | "needs_setup"
  | "planned"

export type DatasetSourceOption = {
  type: string
  label: string
  category?: string
  connection_type?: string
  sync_modes?: string[]
  config_keys?: string[]
  status: DatasetSourceStatus
  description: string
  availability_note?: string | null
  optional_dependencies?: string[]
  environment_keys?: string[]
  environment_configured?: boolean
  configured_environment_keys?: string[]
}

export type DataSourceConnectionStatus =
  | "draft"
  | "planned"
  | "needs_setup"
  | "connected"
  | "error"

export type DataSourceConnection = {
  id: number
  user_id: string
  workspace_id?: string | null
  source_type: string
  source_label: string
  source_status?: DatasetSourceStatus | null
  availability_note?: string | null
  environment_configured?: boolean | null
  display_name: string
  status: DataSourceConnectionStatus
  has_config: boolean
  last_synced_at?: string | null
  created_at?: string
  updated_at?: string
}

export type DataSourceConnectionCreatePayload = {
  source_type: string
  display_name?: string
  connection_config?: Record<string, unknown>
}

export type DataSourceConnectionUpdatePayload = {
  display_name?: string
  connection_config?: Record<string, unknown>
}

export type DashboardAggregation =
  | "daily"
  | "weekly"
  | "quarterly"
  | "monthly"

export type DashboardPreferencePayload = {
  title?: string
  subtitle?: string
  selectedMetrics?: string[]
  aggregation?: DashboardAggregation
  chartType?: "line" | "bar" | "area"
  scaleMode?: "actual" | "indexed"
  periodFilter?:
    | "1m"
    | "1q"
    | "6m"
    | "1y"
    | "2y"
    | "3y"
    | "5y"
    | "all"
  dashboardTemplate?:
    | "executive"
    | "performance"
    | "comparison"
  startDate?: string
  metricMappings?: Record<string, DashboardMetricMapping>
  chartTitles?: Record<string, DashboardChartTitles>
}

export type DashboardMetricMapping = {
  primary?: string
  category?: string
  stage?: string
  date?: string
}

export type DashboardChartTitleKey =
  | "trend"
  | "mix"
  | "operations"
  | "outcome"

export type DashboardChartTitles = Partial<
  Record<DashboardChartTitleKey, string>
>

export type SelectedDashboardPreference = {
  selected_dashboard: string
}

export type DatasetPreferenceResponse = {
  selected_dataset_id: number | null
  selected_metric?: string | null
  metric_targets?: Record<string, Record<string, number>> | null
  dashboard_preferences?: Record<
    string,
    DashboardPreferencePayload
  > | null
}

export type DatasetShareLink = {
  dataset_id: number
  dashboard?: string
  share_token: string
  share_enabled: boolean
}

export type DatasetShareStatus = {
  dataset_id: number
  dashboard?: string
  share_enabled: boolean
}

export type DatasetShareResult = {
  dataset_id: number
  dashboard?: string
  share_token: string | null
  share_enabled: boolean
}

export type StopAllDatasetSharingResult = {
  datasets_updated: number
  legacy_shares_cleared?: number
  dashboard_shares_deleted: number
  shares_stopped?: number
  share_enabled: boolean
}

export type AllDatasetSharingStatus = {
  datasets_checked: number
  legacy_shares: number
  dashboard_shares: number
  shares_active: number
  share_enabled: boolean
}

export type WeeklyReportPreference = {
  enabled: boolean
  cadence: "weekly"
  delivery_day:
    | "monday"
    | "tuesday"
    | "wednesday"
    | "thursday"
    | "friday"
  recipient_emails: string[]
  metric_focus: string[]
  include_recommendations: boolean
  sender_name: string
  sender_email: string
  reply_to_email: string
  subject_prefix: string
  smtp_host: string
  smtp_port?: number | null
  smtp_username: string
  smtp_password?: string
  smtp_clear_password?: boolean
  smtp_password_set: boolean
  smtp_use_tls: boolean
  smtp_use_ssl: boolean
  last_sent_at?: string | null
  last_send_status?: string | null
  last_send_error?: string | null
}

export type WeeklyReportDigestMetric = {
  dataset_id: number
  dataset_name: string
  column: string
  total?: number | null
  average?: number | null
  minimum?: number | null
  maximum?: number | null
}

export type AIAnalysis = {
  source: "openai" | "rules"
  model?: string | null
  metric?: string | null
  fallback_reason?:
    | "not_configured"
    | "unsupported_provider"
    | "provider_unavailable"
    | null
  summary: string
  recommendations: string[]
  risks: string[]
  confidence: "high" | "medium" | "low"
  learning_context?: {
    learning_scope?:
      | "workspace"
      | "dataset"
      | "metric"
      | "decision"
    recorded_lesson_count: number
    recorded_outcome_count: number
    recorded_recommendation_count: number
    sampled_lesson_count: number
    sampled_evidence_count: number
  } | null
}

export type WeeklyReportAIAnalysis = AIAnalysis

export type WeeklyReportDigest = {
  enabled: boolean
  cadence: "weekly"
  delivery_day:
    | "monday"
    | "tuesday"
    | "wednesday"
    | "thursday"
    | "friday"
  recipient_emails: string[]
  metric_focus: string[]
  sender_name: string
  sender_email: string
  reply_to_email: string
  subject_prefix: string
  brand_name: string
  subject: string
  preview_text: string
  ai_analysis?: WeeklyReportAIAnalysis | null
  dataset_count: number
  metrics: WeeklyReportDigestMetric[]
  recommendations: string[]
  unavailable_datasets: string[]
}

export type WeeklyReportDeliveryResult = {
  status: "sent"
  workspace_id: string
  delivered_count: number
  recipients: string[]
  subject: string
  metrics_count: number
  sent_at: string
}

export type WeeklyReportDeliveryConfig = {
  email_delivery_configured: boolean
  scheduler_configured: boolean
  required_email_environment_keys: string[]
  optional_email_environment_keys: string[]
  scheduler_environment_key: string
  scheduler_header_name: string
  send_due_endpoint: string
  ai_provider_configured?: boolean
  ai_provider?: string
  ai_model?: string | null
}

export type AIStatus = {
  configured: boolean
  provider: string
  model?: string | null
}

export type ApiHealthStatus = {
  status: string
  service: string
  capabilities?: {
    ai?: AIStatus
    analytics?: AnalyticsEngineStatus
  }
}

export type PublicSharedDashboardResponse = {
  branding: {
    name: string
    logo_url?: string | null
    primary_color?: string | null
    accent_color?: string | null
  }
  dataset: {
    file_name: string
    row_count?: number
    source_type?: string | null
    source_label?: string | null
    source_config?: string | null
    preview?: Record<
      string,
      string | number | Date | null | undefined
    >[]
    metrics: {
      column: string
      total?: number
      average?: number
      min?: number
      max?: number
      minimum?: number
      maximum?: number
    }[]
    chart?: {
      x_key?: string
      y_key?: string
      data?: Record<
        string,
        string | number | Date | null | undefined
      >[]
    }
  }
  preference: {
    metric_targets?: Record<
      string,
      Record<string, number>
    > | null
    dashboard_preferences?: Record<
      string,
      {
        title?: string
        subtitle?: string
        selectedMetrics?: string[]
        aggregation?: DashboardAggregation
        chartType?: "line" | "bar" | "area"
        scaleMode?: "actual" | "indexed"
        periodFilter?:
          | "1m"
          | "1q"
          | "6m"
          | "1y"
          | "2y"
          | "3y"
          | "5y"
          | "all"
        dashboardTemplate?:
          | "executive"
          | "performance"
          | "comparison"
        startDate?: string
        metricMappings?: Record<
          string,
          Record<string, string>
        >
        chartTitles?: Record<
          string,
          DashboardChartTitles
        >
      }
    > | null
  }
  decision_summary?: DecisionSummary | null
}

export type ForecastResponse = {
  dataset_id: number
  file_name: string
  source_type?: string | null
  source_label?: string | null
  source_config?: string | null
  historical: Record<
    string,
    string | number | boolean | null | undefined
  >[]
  forecast: {
    date_column: string
    value_column: string
    forecast: number[]
    forecast_periods?: string[]
    summary?: {
      current_value: number
      forecast_value: number
      absolute_change: number
      percent_change: number
      direction:
        | "increase"
        | "decrease"
        | "stable"
      forecast_period?: string | null
    }
    model_quality?: {
      method: string
      candidate_count?: number
      validation_periods: number
      mae: number | null
      mape: number | null
      reliability?:
        | "limited"
        | "low"
        | "moderate"
        | "good"
    }
    available_metrics?: string[]
    recommendation: {
      title: string
      reason: string
      confidence: DecisionConfidenceScore
    }
    ai_analysis?: AIAnalysis
  }
}


/* =========================
   Decision API Response Types For Portfolio And Detail Pages
========================= */

export type DecisionStatus =
  | "planned"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "archived"

export type DecisionPriority =
  | "high"
  | "medium"
  | "low"

export type DecisionCategory =
  | "general"
  | "marketing"
  | "sales"
  | "operations"
  | "finance"
  | "hiring"
  | "product"

export type DecisionOutcomeStatus =
  | "successful"
  | "partially_successful"
  | "unsuccessful"

export type DecisionConfidenceScore =
  | "high"
  | "medium"
  | "low"

export type DecisionActivityType =
  | "created"
  | "status"
  | "archive"
  | "restore"
  | "overview"
  | "details"
  | "notes"
  | "outcome"
  | "learning"
  | "review"
  | "priority"
  | "category"
  | "confidence"

export type DecisionRecord = {
  id: number
  workspace_id?: string | null
  dataset_id: number
  metric_column?: string | null
  recommendation_text?: string | null
  recommendation_source?: "openai" | "rules" | null
  recommendation_context?: string | null
  title: string
  description?: string | null
  notes?: string | null
  status?: DecisionStatus | null
  priority?: DecisionPriority | null
  category?: DecisionCategory | null
  confidence_score?: DecisionConfidenceScore | null
  review_date?: string | null
  expected_outcome?: string | null
  actual_outcome?: string | null
  outcome_status?: DecisionOutcomeStatus | null
  lessons_learned?: string | null
  created_at: string
  updated_at?: string | null
}

export type DecisionSummary = {
  total: number
  active: number
  archived: number
  attention_required: number
  learning_captured: number
  learning_pending: number
  notes_added: number
  notes_pending: number
  outcomes_planned: number
  outcomes_pending: number
  outcomes_recorded: number
  outcomes_evaluated: number
  reviews_overdue: number
  reviews_scheduled: number
  reviews_upcoming: number
  by_created_month: Record<string, number>
  by_status: Record<string, number>
  by_outcome_status: Record<string, number>
  by_category: Record<string, number>
  ai_analysis?: AIAnalysis | null
}

export type DecisionOutcomeAnalysisResponse = {
  decision_id: number
  ai_analysis: AIAnalysis
}

export type DecisionActivity = {
  id: number
  decision_id: number
  workspace_id?: string | null
  activity_type: DecisionActivityType
  message: string
  created_at: string
}

export type DecisionActivityFeedItem =
  DecisionActivity & {
    decision_title: string
    decision_available?: boolean
  }

export type DecisionCreatePayload = {
  dataset_id: number
  metric_column?: string
  recommendation_text?: string | null
  recommendation_source?: "openai" | "rules" | null
  recommendation_context?: string | null
  title: string
  description?: string
  expected_outcome: string
  priority?: DecisionPriority
  category?: DecisionCategory
  confidence_score?: DecisionConfidenceScore
  review_date?: string
}

export type DecisionOverviewPayload = {
  status?: DecisionStatus
  priority?: DecisionPriority
  category?: DecisionCategory
  confidence_score?: DecisionConfidenceScore | null
  review_date?: string | null
}

export type DecisionDetailsPayload = {
  title?: string
  description?: string | null
  metric_column?: string | null
}

export type DecisionOutcomePayload = {
  expected_outcome?: string | null
  actual_outcome?: string | null
  outcome_status?: DecisionOutcomeStatus | null
}

export type OrganizationRecord = {
  id: number
  name: string
  logo_url?: string | null
  primary_color?: string | null
  accent_color?: string | null
  report_display_name?: string | null
}

export type OrganizationBrandingPayload = {
  name: string
  logo_url?: string | null
  primary_color?: string | null
  accent_color?: string | null
  report_display_name?: string | null
}

export type OrganizationWorkspaceRecord = {
  id: number
  name: string
  owner_user_id: string
  role: string
  logo_url?: string | null
  primary_color?: string | null
  accent_color?: string | null
  report_display_name?: string | null
}

export type OrganizationMemberRecord = {
  id: number
  organization_id: number
  clerk_user_id: string
  role: string
}

export type OrganizationInviteRecord = {
  id: number
  organization_id: number
  email: string
  role: string
  status: string
}

export type OrganizationMemberCreatePayload = {
  clerk_user_id: string
  role: string
}

export type OrganizationInviteCreatePayload = {
  email: string
  role: string
}

/* =========================
   Workspace Header Helpers For Personal And Shared Workspace Requests
========================= */

type ClerkBrowserSession = {
  getToken: () => Promise<string | null>
}

type ClerkBrowser = {
  session?: ClerkBrowserSession | null
}

type AuthenticatedHeaders =
  Record<string, string>

const clerkTokenTimeoutMs = 1500
const apiRequestTimeoutMs = 10000
const apiReadCacheTtlMs = 15000
const clerkBearerAuthEnabled =
  process.env.NEXT_PUBLIC_ENABLE_API_BEARER_AUTH === "true"

type ApiReadCacheEntry<T> = {
  expiresAt: number
  promise: Promise<T>
}

export type ApiAvailabilityEventDetail = {
  available: boolean
  message?: string
}

let apiAvailabilitySnapshot:
  | ApiAvailabilityEventDetail
  | null = null

export function getApiAvailabilitySnapshot() {
  return apiAvailabilitySnapshot
}

const apiReadCache =
  new Map<string, ApiReadCacheEntry<unknown>>()

declare global {
  interface Window {
    Clerk?: ClerkBrowser
  }
}

async function getClerkSessionToken() {
  if (!clerkBearerAuthEnabled) {
    return null
  }

  if (typeof window === "undefined") {
    return null
  }

  const tokenPromise =
    window.Clerk?.session?.getToken()

  if (!tokenPromise) {
    return null
  }

  return Promise.race([
    tokenPromise,
    new Promise<null>((resolve) => {
      window.setTimeout(
        () => resolve(null),
        clerkTokenTimeoutMs
      )
    }),
  ])
}

async function withAuthorizationHeader(
  headers: AuthenticatedHeaders
) {
  const token =
    await getClerkSessionToken()

  if (!token) {
    return headers
  }

  return {
    ...headers,
    Authorization: `Bearer ${token}`,
  }
}

async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit
) {
  if (typeof window === "undefined") {
    const controller = new AbortController()
    const callerSignal = init?.signal
    let timedOut = false
    const abortFromCaller = () => {
      controller.abort()
    }

    if (callerSignal) {
      if (callerSignal.aborted) {
        controller.abort()
      } else {
        callerSignal.addEventListener(
          "abort",
          abortFromCaller,
          { once: true }
        )
      }
    }

    const timeoutId = setTimeout(
      () => {
        timedOut = true
        controller.abort()
      },
      apiRequestTimeoutMs
    )

    try {
      return await fetch(
        input,
        {
          ...init,
          signal: controller.signal,
        }
      )
    } catch (error) {
      if (
        error instanceof DOMException &&
        error.name === "AbortError"
      ) {
        if (!timedOut) {
          throw error
        }

        throw new Error(
          "API request timed out. Check that the backend is running and responding."
        )
      }

      if (error instanceof TypeError) {
        throw new Error(
          "API service is unavailable. Check that the backend is running and reachable."
        )
      }

      throw error
    } finally {
      clearTimeout(timeoutId)
      callerSignal?.removeEventListener(
        "abort",
        abortFromCaller
      )
    }
  }

  const controller =
    new AbortController()
  const callerSignal = init?.signal
  let timedOut = false
  const abortFromCaller = () => {
    controller.abort()
  }

  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort()
    } else {
      callerSignal.addEventListener(
        "abort",
        abortFromCaller,
        { once: true }
      )
    }
  }

  const timeoutId =
    window.setTimeout(
      () => {
        timedOut = true
        controller.abort()
      },
      apiRequestTimeoutMs
    )

  try {
    const response = await fetch(
      input,
      {
        ...init,
        signal: controller.signal,
      }
    )

    if (response.status >= 500) {
      notifyApiAvailability({
        available: false,
        message:
          "The API service returned an error. Check the backend logs and try again.",
      })
    } else {
      notifyApiAvailability({
        available: true,
      })
    }

    return response
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      if (!timedOut) {
        throw error
      }

      const message =
        "API request timed out. Check that the backend is running and responding."
      notifyApiAvailability({
        available: false,
        message,
      })
      throw new Error(message)
    }

    if (error instanceof TypeError) {
      const message =
        "API service is unavailable. Check that the backend is running and reachable."
      notifyApiAvailability({
        available: false,
        message,
      })
      throw new Error(message)
    }

    throw error
  } finally {
    window.clearTimeout(timeoutId)
    callerSignal?.removeEventListener(
      "abort",
      abortFromCaller
    )
  }
}

function notifyApiAvailability(
  detail: ApiAvailabilityEventDetail
) {
  if (typeof window === "undefined") {
    return
  }

  apiAvailabilitySnapshot = detail

  window.dispatchEvent(
    new CustomEvent<ApiAvailabilityEventDetail>(
      apiAvailabilityChangedEvent,
      { detail }
    )
  )
}

async function decisionHeaders(
  userId: string,
  workspaceId?: string
) {
  return workspaceJsonHeaders(
    userId,
    workspaceId
  )
}

function cleanHeaderIdentity(
  value: string | undefined,
  fallback = ""
) {
  return value?.trim() || fallback
}

async function workspaceHeaders(
  userId: string,
  workspaceId?: string
) {
  const cleanUserId =
    cleanHeaderIdentity(userId)
  const activeWorkspaceId =
    cleanHeaderIdentity(
      workspaceId,
      getActiveWorkspaceId(cleanUserId)
    )

  return withAuthorizationHeader(
    {
      "X-User-Id":
        cleanUserId,
      "X-Workspace-Id":
        activeWorkspaceId,
    }
  )
}

async function workspaceJsonHeaders(
  userId: string,
  workspaceId?: string
) {
  const cleanUserId =
    cleanHeaderIdentity(userId)
  const activeWorkspaceId =
    cleanHeaderIdentity(
      workspaceId,
      getActiveWorkspaceId(cleanUserId)
    )

  return withAuthorizationHeader(
    {
      "Content-Type":
        "application/json",
      "X-User-Id":
        cleanUserId,
      "X-Workspace-Id":
        activeWorkspaceId,
    }
  )
}

/* =========================
   Organization Owner Headers For Settings And Workspace Switching
========================= */

async function organizationOwnerHeaders(
  userId: string
) {
  return workspaceHeaders(
    userId,
    userId
  )
}

async function organizationOwnerJsonHeaders(
  userId: string
) {
  return workspaceJsonHeaders(
    userId,
    userId
  )
}

/* =========================
   API Error Message Helper For Backend Validation Feedback
========================= */

async function throwApiError(
  response: Response,
  fallbackMessage: string
): Promise<never> {
  throw new ApiError(
    await readApiErrorMessage(
      response,
      fallbackMessage
    ),
    response.status
  )
}

async function fetchOrganizationRequest(
  input: string,
  init: RequestInit
): Promise<Response> {
  try {
    return await apiFetch(
      input,
      init
    )
  } catch (error) {
    rethrowApiFetchError(
      error,
      "Organization service is unavailable."
    )
  }
}

function rethrowApiFetchError(
  error: unknown,
  fallbackMessage: string
): never {
  if (error instanceof Error && error.message) {
    const normalizedMessage =
      error.message.trim().toLowerCase()
    const isTransportFailure =
      normalizedMessage === "failed to fetch" ||
      normalizedMessage === "fetch failed" ||
      normalizedMessage === "load failed" ||
      normalizedMessage === "network request failed"

    if (!isTransportFailure) {
      throw error
    }
  }

  throw new Error(fallbackMessage)
}

export class ApiError extends Error {
  status: number

  constructor(
    message: string,
    status: number
  ) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

function getWorkspaceCacheIdentity(
  userId: string,
  workspaceId?: string
) {
  const cleanUserId =
    cleanHeaderIdentity(userId)
  const activeWorkspaceId =
    cleanHeaderIdentity(
      workspaceId,
      getActiveWorkspaceId(cleanUserId)
    )

  return `${cleanUserId}:${activeWorkspaceId}`
}

function getCachedRead<T>(
  cacheKey: string,
  loader: () => Promise<T>
): Promise<T> {
  if (typeof window === "undefined") {
    return loader()
  }

  const now = Date.now()
  const cachedEntry =
    apiReadCache.get(cacheKey) as
      | ApiReadCacheEntry<T>
      | undefined

  if (
    cachedEntry &&
    cachedEntry.expiresAt > now
  ) {
    return cachedEntry.promise
  }

  const promise =
    loader().catch((error) => {
      const currentEntry =
        apiReadCache.get(cacheKey)

      if (currentEntry?.promise === promise) {
        apiReadCache.delete(cacheKey)
      }

      throw error
    })

  apiReadCache.set(
    cacheKey,
    {
      expiresAt: now + apiReadCacheTtlMs,
      promise,
    }
  )

  return promise
}

function enqueueDatasetPreferenceWrite<T>(
  cacheKey: string,
  writer: () => Promise<T>
) {
  const previousWrite =
    datasetPreferenceWriteQueues.get(cacheKey) ??
    Promise.resolve()
  const nextWrite = previousWrite
    .catch(() => undefined)
    .then(writer)
  const settledWrite = nextWrite.then(
    () => undefined,
    () => undefined
  )

  datasetPreferenceWriteQueues.set(
    cacheKey,
    settledWrite
  )

  return nextWrite.finally(() => {
    if (
      datasetPreferenceWriteQueues.get(cacheKey) ===
      settledWrite
    ) {
      datasetPreferenceWriteQueues.delete(cacheKey)
    }
  })
}

function invalidateApiReadCache(
  prefixes: string[]
) {
  if (typeof window === "undefined") {
    return
  }

  for (const cacheKey of apiReadCache.keys()) {
    if (
      prefixes.some((prefix) =>
        cacheKey.startsWith(prefix)
      )
    ) {
      apiReadCache.delete(cacheKey)
    }
  }

  if (
    prefixes.some((prefix) =>
      prefix.startsWith(
        "organization-workspaces:"
      )
    )
  ) {
    notifyWorkspaceAccessChanged()
  }
}

function cleanPositiveIntegerId(
  value: number,
  label: string
) {
  if (
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new ApiError(
      `${label} must be a positive integer.`,
      400
    )
  }

  return value
}

function cleanOptionalStringField(
  value: string | undefined
) {
  const cleanValue = value?.trim()

  return cleanValue || undefined
}

function cleanDataSourceConfig(
  config:
    | Record<string, unknown>
    | undefined,
  {
    allowEmpty = false,
  }: {
    allowEmpty?: boolean
  } = {}
) {
  if (config == null) {
    return undefined
  }

  const cleanConfig =
    Object.entries(config).reduce<
      Record<string, unknown>
    >((result, [key, value]) => {
      const cleanKey = key.trim()

      if (!cleanKey) {
        return result
      }

      if (typeof value === "string") {
        const cleanValue = value.trim()

        if (!cleanValue) {
          return result
        }

        result[cleanKey] = cleanValue
        return result
      }

      result[cleanKey] = value
      return result
    }, {})

  return Object.keys(cleanConfig).length
    ? cleanConfig
    : allowEmpty
      ? {}
      : undefined
}

function cleanDataSourceCreatePayload(
  payload: DataSourceConnectionCreatePayload
): DataSourceConnectionCreatePayload {
  const sourceType =
    payload.source_type.trim()

  if (!sourceType) {
    throw new ApiError(
      "Source type is required.",
      400
    )
  }

  return {
    source_type: sourceType,
    display_name:
      cleanOptionalStringField(
        payload.display_name
      ),
    connection_config:
      cleanDataSourceConfig(
        payload.connection_config
      ),
  }
}

function cleanDataSourceUpdatePayload(
  payload: DataSourceConnectionUpdatePayload
): DataSourceConnectionUpdatePayload {
  return {
    display_name:
      cleanOptionalStringField(
        payload.display_name
      ),
    connection_config:
      payload.connection_config === undefined
        ? undefined
        : cleanDataSourceConfig(
            payload.connection_config,
            {
              allowEmpty: true,
            }
          ),
  }
}

function getCleanPreferenceDatasetKey(
  value: string
) {
  const datasetId = Number(value)

  return Number.isInteger(datasetId) &&
    datasetId > 0
    ? String(datasetId)
    : null
}

function cleanMetricTargets(
  metricTargets:
    | Record<string, Record<string, number>>
    | undefined
) {
  if (!metricTargets) {
    return undefined
  }

  return Object.entries(metricTargets).reduce<
    Record<string, Record<string, number>>
  >((result, [datasetKey, targets]) => {
    const cleanDatasetKey =
      getCleanPreferenceDatasetKey(datasetKey)

    if (
      !cleanDatasetKey ||
      !targets ||
      typeof targets !== "object" ||
      Array.isArray(targets)
    ) {
      return result
    }

    const cleanTargets =
      Object.entries(targets).reduce<
        Record<string, number>
      >((targetResult, [metric, value]) => {
        const cleanMetric = metric.trim()

        if (
          cleanMetric &&
          Number.isFinite(value)
        ) {
          targetResult[cleanMetric] = value
        }

        return targetResult
      }, {})

    result[cleanDatasetKey] = cleanTargets
    return result
  }, {})
}

function cleanDashboardPreferences(
  dashboardPreferences:
    | Record<string, Record<string, unknown>>
    | undefined
) {
  if (!dashboardPreferences) {
    return undefined
  }

  return Object.entries(
    dashboardPreferences
  ).reduce<
    Record<string, DashboardPreferencePayload>
  >((result, [datasetKey, preference]) => {
    const cleanDatasetKey =
      getCleanPreferenceDatasetKey(datasetKey)

    if (
      !cleanDatasetKey ||
      !preference ||
      typeof preference !== "object" ||
      Array.isArray(preference)
    ) {
      return result
    }

    const cleanPreference =
      cleanDashboardPreference(preference)

    result[cleanDatasetKey] =
      cleanPreference
    return result
  }, {})
}

function cleanDashboardPreference(
  preference: Record<string, unknown>
): DashboardPreferencePayload {
  const cleanPreference: DashboardPreferencePayload = {}
  const cleanTitle =
    getCleanDashboardPreferenceText(
      preference.title,
      maxDashboardTitleLength
    )
  const cleanSubtitle =
    getCleanDashboardPreferenceText(
      preference.subtitle,
      maxDashboardSubtitleLength
    )

  if (cleanTitle) {
    cleanPreference.title = cleanTitle
  }

  if (cleanSubtitle) {
    cleanPreference.subtitle = cleanSubtitle
  }

  const selectedMetrics =
    preference.selectedMetrics

  if (Array.isArray(selectedMetrics)) {
    const cleanMetrics = Array.from(
      new Set(
        selectedMetrics.filter(
          (metric): metric is string =>
            typeof metric === "string" &&
            Boolean(metric.trim())
        ).map((metric) => metric.trim())
      )
    )

    if (cleanMetrics.length > 0) {
      cleanPreference.selectedMetrics =
        cleanMetrics
    }
  }

  if (isChartType(preference.chartType)) {
    cleanPreference.chartType =
      preference.chartType
  }

  if (isDashboardAggregation(preference.aggregation)) {
    cleanPreference.aggregation =
      preference.aggregation
  }

  if (isScaleMode(preference.scaleMode)) {
    cleanPreference.scaleMode =
      preference.scaleMode
  }

  if (isPeriodFilter(preference.periodFilter)) {
    cleanPreference.periodFilter =
      preference.periodFilter
  }

  if (
    isDashboardTemplate(
      preference.dashboardTemplate
    )
  ) {
    cleanPreference.dashboardTemplate =
      preference.dashboardTemplate
  }

  if (
    typeof preference.startDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(
      preference.startDate
    )
  ) {
    cleanPreference.startDate =
      preference.startDate
  }

  if (
    preference.metricMappings &&
    typeof preference.metricMappings === "object" &&
    !Array.isArray(preference.metricMappings)
  ) {
    const cleanMappings =
      Object.fromEntries(
        Object.entries(
          preference.metricMappings
        ).map(([dashboard, mapping]) => [
          dashboard,
          cleanDashboardPreferenceMapping(mapping),
        ]).filter(
          ([dashboard, mapping]) =>
            typeof dashboard === "string" &&
            Boolean(dashboard.trim()) &&
            isDashboardKey(dashboard) &&
            dashboardUsesDatasetMetricMapping(
              getDashboardDefinition(dashboard).componentKey
            ) &&
            mapping &&
            Object.keys(mapping).length > 0
        )
      )

  if (Object.keys(cleanMappings).length > 0) {
      cleanPreference.metricMappings =
        cleanMappings
    }
  }

  if (
    preference.chartTitles &&
    typeof preference.chartTitles === "object" &&
    !Array.isArray(preference.chartTitles)
  ) {
    const cleanChartTitles =
      Object.fromEntries(
        Object.entries(
          preference.chartTitles as Record<string, unknown>
        ).map(([dashboard, titles]) => [
          dashboard,
          cleanDashboardPreferenceChartTitles(titles),
        ]).filter(
          ([dashboard, titles]) =>
            typeof dashboard === "string" &&
            Boolean(dashboard.trim()) &&
            isDashboardKey(dashboard) &&
            dashboard !== "general-business" &&
            titles &&
            Object.keys(titles).length > 0
        )
      )

    if (Object.keys(cleanChartTitles).length > 0) {
      cleanPreference.chartTitles =
        cleanChartTitles as Record<
          string,
          DashboardChartTitles
        >
    }
  }

  return cleanPreference
}

function cleanDashboardPreferenceChartTitles(
  titles: unknown
): DashboardChartTitles {
  if (
    !titles ||
    typeof titles !== "object" ||
    Array.isArray(titles)
  ) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(titles as Record<string, unknown>)
      .filter(([key]) =>
        [
          "trend",
          "mix",
          "operations",
          "outcome",
        ].includes(key)
      )
      .map(([key, value]) => [
        key,
        typeof value === "string"
          ? value
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, maxDashboardChartTitleLength)
          : "",
      ])
      .filter(([, value]) => Boolean(value))
  ) as DashboardChartTitles
}

function cleanDashboardPreferenceMapping(
  mapping: unknown
) {
  if (
    !mapping ||
    typeof mapping !== "object" ||
    Array.isArray(mapping)
  ) {
    return undefined
  }

  return Object.fromEntries(
    Object.entries(
      mapping as Record<string, unknown>
    ).filter(
      ([key, value]) =>
        [
          "primary",
          "category",
          "stage",
          "date",
        ].includes(key) &&
        typeof value === "string" &&
        Boolean(value.trim())
    ).map(([key, value]) => [
      key,
      String(value).trim(),
    ])
  )
}

function getSafeDashboardPreference(
  preference: unknown
): SelectedDashboardPreference {
  if (
    !preference ||
    typeof preference !== "object" ||
    Array.isArray(preference)
  ) {
    return {
      selected_dashboard: defaultDashboardKey,
    }
  }

  const selectedDashboard = (
    preference as Record<string, unknown>
  ).selected_dashboard

  return {
    selected_dashboard:
      isDashboardKey(selectedDashboard)
        ? selectedDashboard
        : defaultDashboardKey,
  }
}

function getCleanDashboardPreferenceText(
  value: unknown,
  maxLength: number
) {
  if (typeof value !== "string") {
    return undefined
  }

  const cleanValue = value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)

  return cleanValue || undefined
}

function isChartType(
  value: unknown
): value is DashboardPreferencePayload["chartType"] {
  return (
    value === "line" ||
    value === "bar" ||
    value === "area"
  )
}

function isDashboardAggregation(
  value: unknown
): value is DashboardPreferencePayload["aggregation"] {
  return (
    value === "daily" ||
    value === "weekly" ||
    value === "quarterly" ||
    value === "monthly"
  )
}

function isScaleMode(
  value: unknown
): value is DashboardPreferencePayload["scaleMode"] {
  return (
    value === "actual" ||
    value === "indexed"
  )
}

function isPeriodFilter(
  value: unknown
): value is DashboardPreferencePayload["periodFilter"] {
  return (
    value === "1m" ||
    value === "1q" ||
    value === "6m" ||
    value === "1y" ||
    value === "2y" ||
    value === "3y" ||
    value === "5y" ||
    value === "all"
  )
}

function isDashboardTemplate(
  value: unknown
): value is DashboardPreferencePayload["dashboardTemplate"] {
  return (
    value === "executive" ||
    value === "performance" ||
    value === "comparison"
  )
}

function cleanPaginationLimit(
  value: number | undefined,
  fallback?: number
) {
  if (
    value === undefined ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return fallback
  }

  return Math.min(
    100,
    Math.floor(value)
  )
}

function cleanPaginationOffset(
  value: number | undefined,
  fallback = 0
) {
  if (
    value === undefined ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    return fallback
  }

  return Math.floor(value)
}

/* =========================
   Decision List Query String Helper For Filters Search And Pagination
========================= */

function buildDecisionListQuery(
  options?: DecisionListOptions
) {
  if (!options) {
    return ""
  }

  const params =
    new URLSearchParams()

  if (options.status) {
    params.set(
      "status",
      options.status
    )
  }

  if (options.lifecycle) {
    params.set(
      "lifecycle",
      options.lifecycle
    )
  }

  if (options.category) {
    params.set(
      "category",
      options.category
    )
  }

  if (options.attentionState) {
    params.set(
      "attention_state",
      options.attentionState
    )
  }

  if (options.outcomeState) {
    params.set(
      "outcome_state",
      options.outcomeState
    )
  }

  if (options.learningState) {
    params.set(
      "learning_state",
      options.learningState
    )
  }

  if (options.notesState) {
    params.set(
      "notes_state",
      options.notesState
    )
  }

  if (options.reviewState) {
    params.set(
      "review_state",
      options.reviewState
    )
  }

  if (options.search?.trim()) {
    params.set(
      "search",
      options.search.trim()
    )
  }

  if (options.sort) {
    params.set(
      "sort",
      options.sort
    )
  }

  const cleanLimit =
    cleanPaginationLimit(options.limit)
  const cleanOffset =
    cleanPaginationOffset(options.offset)

  if (cleanLimit !== undefined) {
    params.set(
      "limit",
      String(cleanLimit)
    )
  }

  if (options.offset !== undefined) {
    params.set(
      "offset",
      String(cleanOffset)
    )
  }

  const queryString =
    params.toString()

  return queryString
    ? `?${queryString}`
    : ""
}

/* =========================
   Dataset CRUD API For Upload Browse Detail And Delete
========================= */

export async function uploadDataset(
  file: File,
  userId: string,
  workspaceId?: string
) {
  const formData =
    new FormData()

  formData.append(
    "file",
    file
  )

  const response =
    await apiFetch(
      `${API_URL}/datasets/upload`,
      {
        method: "POST",
        headers: await workspaceHeaders(
          userId,
          workspaceId
        ),
        body: formData,
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Upload failed"
    )
  }

  invalidateApiReadCache([
    `datasets:${getWorkspaceCacheIdentity(
      userId,
      workspaceId
    )}`,
    `dataset-metrics:${getWorkspaceCacheIdentity(
      userId,
      workspaceId
    )}:`,
    `dataset-preference:${getWorkspaceCacheIdentity(
      userId,
      workspaceId
    )}`,
  ])

  return response.json()
}

export async function getDatasets(
  userId: string,
  workspaceId?: string
): Promise<DatasetSummary[]> {
  const cacheKey =
    `datasets:${getWorkspaceCacheIdentity(
      userId,
      workspaceId
    )}`

  return getCachedRead(
    cacheKey,
    async () => {
      let response: Response

      try {
        response =
          await apiFetch(
            `${API_URL}/datasets/`,
            {
              headers: await workspaceHeaders(
                userId,
                workspaceId
              ),
            }
          )
      } catch (error) {
        rethrowApiFetchError(
          error,
          "Dataset service is unavailable."
        )
      }

      if (!response.ok) {
        await throwApiError(
          response,
          "Failed to load datasets"
        )
      }

      return response.json()
    }
  )
}

export async function getDatasetMetrics(
  id: number,
  userId: string,
  workspaceId?: string
): Promise<DatasetMetricsResponse> {
  const cleanDatasetId =
    cleanPositiveIntegerId(
      id,
      "Dataset id"
    )
  const cacheIdentity =
    getWorkspaceCacheIdentity(
      userId,
      workspaceId
    )
  const cacheKey =
    `dataset-metrics:${cacheIdentity}:${cleanDatasetId}`

  return getCachedRead(
    cacheKey,
    async () => {
      const response =
        await apiFetch(
          `${API_URL}/datasets/${cleanDatasetId}/metrics`,
          {
            headers: await workspaceHeaders(
              userId,
              workspaceId
            ),
          }
        )

      if (!response.ok) {
        await throwApiError(
          response,
          "Failed to load dataset metrics"
        )
      }

      return response.json()
    }
  )
}

export async function getDatasetSources(
  userId: string,
  workspaceId?: string
): Promise<DatasetSourceOption[]> {
  let response: Response

  try {
    response =
      await apiFetch(
        `${API_URL}/datasets/sources`,
        {
          headers: await workspaceHeaders(
            userId,
            workspaceId
          ),
        }
      )
  } catch (error) {
    rethrowApiFetchError(
      error,
      "Dataset source service is unavailable."
    )
  }

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to load dataset sources"
    )
  }

  const data = await response.json()

  return data.sources ?? []
}

export async function getAnalyticsEngineStatus(
  userId: string,
  workspaceId?: string
): Promise<AnalyticsEngineStatus> {
  const response =
    await apiFetch(
      `${API_URL}/datasets/analytics/status`,
      {
        headers: await workspaceHeaders(
          userId,
          workspaceId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to load analytics engine status"
    )
  }

  return response.json()
}

export async function getDataSourceConnections(
  userId: string,
  workspaceId?: string
): Promise<DataSourceConnection[]> {
  let response: Response

  try {
    response =
      await apiFetch(
        `${API_URL}/datasets/source-connections`,
        {
          headers: await workspaceHeaders(
            userId,
            workspaceId
          ),
        }
      )
  } catch (error) {
    rethrowApiFetchError(
      error,
      "Data source connection service is unavailable."
    )
  }

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to load data source connections"
    )
  }

  return response.json()
}

export async function getWeeklyReportPreference(
  userId: string,
  workspaceId?: string
): Promise<WeeklyReportPreference> {
  const response =
    await apiFetch(
      `${API_URL}/alerts/weekly-report`,
      {
        headers: await workspaceHeaders(
          userId,
          workspaceId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to load weekly report setup"
    )
  }

  return response.json()
}

export async function getWeeklyReportDigest(
  userId: string,
  workspaceId?: string
): Promise<WeeklyReportDigest> {
  const response =
    await apiFetch(
      `${API_URL}/alerts/weekly-report/digest`,
      {
        headers: await workspaceHeaders(
          userId,
          workspaceId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to load weekly report preview"
    )
  }

  return response.json()
}

export async function getWeeklyReportDeliveryConfig(
  userId: string,
  workspaceId?: string
): Promise<WeeklyReportDeliveryConfig> {
  const response =
    await apiFetch(
      `${API_URL}/alerts/weekly-report/delivery-config`,
      {
        headers: await workspaceHeaders(
          userId,
          workspaceId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to load weekly report delivery configuration"
    )
  }

  return response.json()
}

export async function getAIStatus(
  userId: string,
  workspaceId?: string
): Promise<AIStatus> {
  const response =
    await apiFetch(
      `${API_URL}/ai/status`,
      {
        headers: await workspaceHeaders(
          userId,
          workspaceId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to load AI status"
    )
  }

  return response.json()
}

export async function getApiHealthStatus(): Promise<ApiHealthStatus> {
  const response =
    await apiFetch(
      `${API_URL}/health`,
      {
        cache: "no-store",
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to load API health status"
    )
  }

  return response.json()
}

export async function updateWeeklyReportPreference(
  payload: WeeklyReportPreference,
  userId: string,
  workspaceId?: string
): Promise<WeeklyReportPreference> {
  const response =
    await apiFetch(
      `${API_URL}/alerts/weekly-report`,
      {
        method: "PUT",
        headers: await workspaceJsonHeaders(
          userId,
          workspaceId
        ),
        body: JSON.stringify(
          payload
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to save weekly report setup"
    )
  }

  return response.json()
}

export async function sendWeeklyReportNow(
  userId: string,
  workspaceId?: string
): Promise<WeeklyReportDeliveryResult> {
  const response =
    await apiFetch(
      `${API_URL}/alerts/weekly-report/send`,
      {
        method: "POST",
        headers: await workspaceHeaders(
          userId,
          workspaceId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to send weekly KPI email"
    )
  }

  return response.json()
}

export async function sendWeeklyReportTestEmail(
  userId: string,
  workspaceId?: string
): Promise<WeeklyReportDeliveryResult> {
  const response =
    await apiFetch(
      `${API_URL}/alerts/weekly-report/send-test`,
      {
        method: "POST",
        headers: await workspaceHeaders(
          userId,
          workspaceId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to send test KPI email"
    )
  }

  return response.json()
}

export async function createDataSourceConnection(
  payload: DataSourceConnectionCreatePayload,
  userId: string,
  workspaceId?: string
): Promise<DataSourceConnection> {
  const cleanPayload =
    cleanDataSourceCreatePayload(
      payload
    )

  const response =
    await apiFetch(
      `${API_URL}/datasets/source-connections`,
      {
        method: "POST",
        headers: await workspaceJsonHeaders(
          userId,
          workspaceId
        ),
        body: JSON.stringify(
          cleanPayload
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to create data source connection"
    )
  }

  return response.json()
}

export async function updateDataSourceConnection(
  connectionId: number,
  payload: DataSourceConnectionUpdatePayload,
  userId: string,
  workspaceId?: string
): Promise<DataSourceConnection> {
  const cleanConnectionId =
    cleanPositiveIntegerId(
      connectionId,
      "Connection id"
    )
  const cleanPayload =
    cleanDataSourceUpdatePayload(
      payload
    )

  const response =
    await apiFetch(
      `${API_URL}/datasets/source-connections/${cleanConnectionId}`,
      {
        method: "PATCH",
        headers: await workspaceJsonHeaders(
          userId,
          workspaceId
        ),
        body: JSON.stringify(
          cleanPayload
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to update data source connection"
    )
  }

  return response.json()
}

export async function deleteDataSourceConnection(
  connectionId: number,
  userId: string,
  workspaceId?: string
) {
  const cleanConnectionId =
    cleanPositiveIntegerId(
      connectionId,
      "Connection id"
    )

  const response =
    await apiFetch(
      `${API_URL}/datasets/source-connections/${cleanConnectionId}`,
      {
        method: "DELETE",
        headers: await workspaceHeaders(
          userId,
          workspaceId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to delete data source connection"
    )
  }

  return response.json()
}

export async function getDatasetDetails(
  id: number,
  userId: string,
  workspaceId?: string,
  options?: {
    includeAllRows?: boolean
  }
) {
  const cleanDatasetId =
    cleanPositiveIntegerId(
      id,
      "Dataset id"
    )

  const query =
    options?.includeAllRows
      ? "?include_all_rows=true"
      : ""

  const response =
    await apiFetch(
      `${API_URL}/datasets/${cleanDatasetId}/details${query}`,
      {
        headers: await workspaceHeaders(
          userId,
          workspaceId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to load dataset"
    )
  }

  return response.json()
}

export async function getDatasetAIAnalysis(
  id: number,
  userId: string,
  workspaceId?: string,
  metric?: string
): Promise<DatasetAIAnalysisResponse> {
  const cleanDatasetId =
    cleanPositiveIntegerId(
      id,
      "Dataset id"
    )
  const cleanMetric = metric?.trim()
  const query = cleanMetric
    ? `?metric=${encodeURIComponent(cleanMetric)}`
    : ""

  const response =
    await apiFetch(
      `${API_URL}/datasets/${cleanDatasetId}/ai-analysis${query}`,
      {
        headers: await workspaceHeaders(
          userId,
          workspaceId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to load metric AI analysis"
    )
  }

  return response.json()
}

export async function getDatasetAnalytics(
  id: number,
  userId: string,
  workspaceId?: string
): Promise<DatasetAnalyticsManifest> {
  const cleanDatasetId =
    cleanPositiveIntegerId(
      id,
      "Dataset id"
    )

  const response =
    await apiFetch(
      `${API_URL}/datasets/${cleanDatasetId}/analytics`,
      {
        headers: await workspaceHeaders(
          userId,
          workspaceId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to load dataset analytics"
    )
  }

  return response.json()
}

export async function getPublicSharedDashboard(
  datasetId: number,
  token: string,
  dashboard?: string,
  signal?: AbortSignal
): Promise<PublicSharedDashboardResponse | null> {
  const cleanDatasetId =
    cleanPositiveIntegerId(
      datasetId,
      "Dataset id"
    )
  const cleanToken =
    token.trim()

  if (!cleanToken) {
    return null
  }

  const params =
    new URLSearchParams({
      token: cleanToken,
    })

  if (dashboard?.trim()) {
    params.set(
      "dashboard",
      dashboard.trim()
    )
  }

  let response: Response
  const requestController =
    new AbortController()
  let timedOut = false
  const timeoutId = setTimeout(
    () => {
      timedOut = true
      requestController.abort()
    },
    apiRequestTimeoutMs
  )
  const abortRequest = () =>
    requestController.abort()

  if (signal) {
    if (signal.aborted) {
      requestController.abort()
    } else {
      signal.addEventListener(
        "abort",
        abortRequest,
        { once: true }
      )
    }
  }

  try {
    response =
      await fetch(
        `${API_URL}/public/dashboard/${cleanDatasetId}?${params.toString()}`,
        {
          cache: "no-store",
          signal: requestController.signal,
        }
      )
  } catch (error) {
    if (
      error instanceof DOMException &&
      error.name === "AbortError"
    ) {
      if (signal?.aborted && !timedOut) {
        throw error
      }

      throw new Error(
        "Public dashboard request timed out."
      )
    }

    if (error instanceof TypeError) {
      throw new Error(
        "API service is unavailable. Check that the backend is running and reachable."
      )
    }

    throw error
  } finally {
    clearTimeout(timeoutId)

    signal?.removeEventListener(
      "abort",
      abortRequest
    )
  }

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to load performance dashboard"
    )
  }

  return response.json()
}

function buildDashboardShareQuery(
  dashboard: string | undefined
) {
  const cleanDashboard =
    dashboard?.trim()

  if (!isDashboardKey(cleanDashboard)) {
    return ""
  }

  const params =
    new URLSearchParams({
      dashboard: cleanDashboard,
    })

  return `?${params.toString()}`
}

export async function getDatasetShareLink(
  datasetId: number,
  userId: string,
  workspaceId?: string,
  dashboard?: string
): Promise<DatasetShareLink> {
  const cleanDatasetId =
    cleanPositiveIntegerId(
      datasetId,
      "Dataset id"
    )

  const response =
    await apiFetch(
      `${API_URL}/datasets/${cleanDatasetId}/share${buildDashboardShareQuery(dashboard)}`,
      {
        cache: "no-store",
        method: "POST",
        headers: await workspaceHeaders(
          userId,
          workspaceId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to create dashboard share link"
    )
  }

  return response.json()
}

export async function getDatasetShareStatus(
  datasetId: number,
  userId: string,
  workspaceId?: string,
  dashboard?: string
): Promise<DatasetShareStatus> {
  const cleanDatasetId =
    cleanPositiveIntegerId(
      datasetId,
      "Dataset id"
    )

  const response =
    await apiFetch(
      `${API_URL}/datasets/${cleanDatasetId}/share/status${buildDashboardShareQuery(dashboard)}`,
      {
        cache: "no-store",
        headers: await workspaceHeaders(
          userId,
          workspaceId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to load dashboard sharing status"
    )
  }

  return response.json()
}

export async function stopDatasetSharing(
  datasetId: number,
  userId: string,
  workspaceId?: string,
  dashboard?: string
): Promise<DatasetShareResult> {
  const cleanDatasetId =
    cleanPositiveIntegerId(
      datasetId,
      "Dataset id"
    )

  const response =
    await apiFetch(
      `${API_URL}/datasets/${cleanDatasetId}/share${buildDashboardShareQuery(dashboard)}`,
      {
        cache: "no-store",
        method: "DELETE",
        headers: await workspaceHeaders(
          userId,
          workspaceId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to stop sharing dashboard"
    )
  }

  return response.json()
}

export async function stopAllDatasetSharing(
  userId: string,
  workspaceId?: string
): Promise<StopAllDatasetSharingResult> {
  const response =
    await apiFetch(
      `${API_URL}/datasets/share/all`,
      {
        cache: "no-store",
        method: "DELETE",
        headers: await workspaceHeaders(
          userId,
          workspaceId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to stop all dashboard sharing"
    )
  }

  return response.json()
}

export async function getAllDatasetSharingStatus(
  userId: string,
  workspaceId?: string
): Promise<AllDatasetSharingStatus> {
  const response =
    await apiFetch(
      `${API_URL}/datasets/share/status/all`,
      {
        cache: "no-store",
        headers: await workspaceHeaders(
          userId,
          workspaceId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to load dashboard sharing status"
    )
  }

  return response.json()
}

export async function getDataset(
  id: number,
  userId: string,
  workspaceId?: string
): Promise<DatasetSummary> {
  const cleanDatasetId =
    cleanPositiveIntegerId(
      id,
      "Dataset id"
    )

  const response =
    await apiFetch(
      `${API_URL}/datasets/${cleanDatasetId}`,
      {
        headers: await workspaceHeaders(
          userId,
          workspaceId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to load dataset"
    )
  }

  return response.json()
}

export async function deleteDataset(
  id: number,
  userId: string,
  workspaceId?: string
) {
  const cleanDatasetId =
    cleanPositiveIntegerId(
      id,
      "Dataset id"
    )

  const response =
    await apiFetch(
      `${API_URL}/datasets/${cleanDatasetId}`,
      {
        method: "DELETE",
        headers: await workspaceHeaders(
          userId,
          workspaceId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to delete dataset"
    )
  }

  invalidateApiReadCache([
    `datasets:${getWorkspaceCacheIdentity(
      userId,
      workspaceId
    )}`,
    `dataset-metrics:${getWorkspaceCacheIdentity(
      userId,
      workspaceId
    )}:`,
    `dataset-preference:${getWorkspaceCacheIdentity(
      userId,
      workspaceId
    )}`,
  ])

  return response.json()
}

/* =========================
   Organization Profile API For Current User Workspace Setup
========================= */

export async function getMyOrganization(
  userId: string
): Promise<OrganizationRecord | null> {
  const cacheKey =
    `organization:${userId.trim()}`

  return getCachedRead(
    cacheKey,
    async () => {
      const response =
        await fetchOrganizationRequest(
          `${API_URL}/organizations/me`,
          {
            headers: await organizationOwnerHeaders(
              userId
            ),
          }
        )

      if (!response.ok) {
        await throwApiError(
          response,
          "Failed to load organization"
        )
      }

      return response.json()
    }
  )
}

export async function createOrganization(
  payload: string | OrganizationBrandingPayload,
  userId: string
): Promise<OrganizationRecord> {
  const cleanPayload =
    typeof payload === "string"
      ? {
          name: payload,
        }
      : payload

  const response =
    await fetchOrganizationRequest(
      `${API_URL}/organizations`,
      {
        method: "POST",
        headers: await organizationOwnerJsonHeaders(
          userId
        ),
        body: JSON.stringify(
          cleanPayload
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to create organization"
    )
  }

  invalidateApiReadCache([
    `organization:${userId.trim()}`,
    `organization-workspaces:${userId.trim()}`,
  ])

  return response.json()
}

export async function updateMyOrganization(
  payload: string | OrganizationBrandingPayload,
  userId: string
): Promise<OrganizationRecord> {
  const cleanPayload =
    typeof payload === "string"
      ? {
          name: payload,
        }
      : payload

  const response =
    await fetchOrganizationRequest(
      `${API_URL}/organizations/me`,
      {
        method: "PATCH",
        headers: await organizationOwnerJsonHeaders(
          userId
        ),
        body: JSON.stringify(
          cleanPayload
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to update organization"
    )
  }

  invalidateApiReadCache([
    `organization:${userId.trim()}`,
    `organization-workspaces:${userId.trim()}`,
  ])

  return response.json()
}

export async function getOrganizationMembers(
  userId: string
): Promise<OrganizationMemberRecord[]> {
  const response =
    await fetchOrganizationRequest(
      `${API_URL}/organizations/members`,
      {
        headers: await organizationOwnerHeaders(
          userId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to load organization members"
    )
  }

  return response.json()
}

export async function getOrganizationWorkspaces(
  userId: string
): Promise<OrganizationWorkspaceRecord[]> {
  const cacheKey =
    `organization-workspaces:${userId.trim()}`

  return getCachedRead(
    cacheKey,
    async () => {
      const response =
        await fetchOrganizationRequest(
          `${API_URL}/organizations/workspaces`,
          {
            headers: await organizationOwnerHeaders(
              userId
            ),
          }
        )

      if (!response.ok) {
        await throwApiError(
          response,
          "Failed to load organization workspaces"
        )
      }

      return response.json()
    }
  )
}

export async function getOrganizationInvites(
  userId: string
): Promise<OrganizationInviteRecord[]> {
  const response =
    await fetchOrganizationRequest(
      `${API_URL}/organizations/invites`,
      {
        headers: await organizationOwnerHeaders(
          userId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to load organization invites"
    )
  }

  return response.json()
}

export async function addOrganizationInvite(
  payload: OrganizationInviteCreatePayload,
  userId: string
): Promise<OrganizationInviteRecord> {
  const response =
    await fetchOrganizationRequest(
      `${API_URL}/organizations/invites`,
      {
        method: "POST",
        headers: await organizationOwnerJsonHeaders(
          userId
        ),
        body: JSON.stringify(
          payload
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to add organization invite"
    )
  }

  return response.json()
}

export async function addOrganizationMember(
  payload: OrganizationMemberCreatePayload,
  userId: string
): Promise<OrganizationMemberRecord> {
  const response =
    await fetchOrganizationRequest(
      `${API_URL}/organizations/members`,
      {
        method: "POST",
        headers: await organizationOwnerJsonHeaders(
          userId
        ),
        body: JSON.stringify(
          payload
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to add organization member"
    )
  }

  invalidateApiReadCache([
    `organization-workspaces:${userId.trim()}`,
  ])

  return response.json()
}

export async function removeOrganizationInvite(
  inviteId: number,
  userId: string
) {
  const response =
    await fetchOrganizationRequest(
      `${API_URL}/organizations/invites/${inviteId}`,
      {
        method: "DELETE",
        headers: await organizationOwnerHeaders(
          userId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to remove organization invite"
    )
  }

  return response.json()
}

export async function updateOrganizationMemberRole(
  memberId: number,
  role: string,
  userId: string
): Promise<OrganizationMemberRecord> {
  const response =
    await fetchOrganizationRequest(
      `${API_URL}/organizations/members/${memberId}`,
      {
        method: "PATCH",
        headers: await organizationOwnerJsonHeaders(
          userId
        ),
        body: JSON.stringify({
          role,
        }),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to update organization member"
    )
  }

  invalidateApiReadCache([
    `organization-workspaces:${userId.trim()}`,
  ])

  return response.json()
}

export async function removeOrganizationMember(
  memberId: number,
  userId: string
) {
  const response =
    await fetchOrganizationRequest(
      `${API_URL}/organizations/members/${memberId}`,
      {
        method: "DELETE",
        headers: await organizationOwnerHeaders(
          userId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to remove organization member"
    )
  }

  invalidateApiReadCache([
    `organization-workspaces:${userId.trim()}`,
  ])

  return response.json()
}

/* =========================
   Forecast API For Dataset Metric Predictions
========================= */

export async function getForecast(
  datasetId: number,
  userId: string,
  metric?: string,
  workspaceId?: string
): Promise<ForecastResponse> {
  const cleanDatasetId =
    cleanPositiveIntegerId(
      datasetId,
      "Dataset id"
    )
  const cleanMetric =
    metric?.trim() || ""
  const metricQuery =
    cleanMetric
      ? `?metric=${encodeURIComponent(cleanMetric)}`
      : ""
  const response =
    await apiFetch(
      `${API_URL}/forecasting/${cleanDatasetId}${metricQuery}`,
      {
        headers: await workspaceHeaders(
          userId,
          workspaceId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to load forecast"
    )
  }

  return response.json()
}

/* =========================
   Dataset Preference API For Selected Dataset Metrics And Dashboard State
========================= */

export async function getDashboardPreference(
  userId: string,
  workspaceId?: string
): Promise<SelectedDashboardPreference> {
  let response: Response

  try {
    response =
      await apiFetch(
        `${API_URL}/organizations/preferences/dashboard`,
        {
          headers: await workspaceHeaders(
            userId,
            workspaceId
          ),
        }
      )
  } catch (error) {
    rethrowApiFetchError(
      error,
      "Dashboard preference service is unavailable."
    )
  }

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to load dashboard preference"
    )
  }

  return getSafeDashboardPreference(
    await response.json()
  )
}

export async function updateDashboardPreference(
  selectedDashboard: string,
  userId: string,
  workspaceId?: string
): Promise<SelectedDashboardPreference> {
  const safeSelectedDashboard =
    isDashboardKey(selectedDashboard)
      ? selectedDashboard
      : defaultDashboardKey
  let response: Response

  try {
    response =
      await apiFetch(
        `${API_URL}/organizations/preferences/dashboard`,
        {
          method: "PATCH",
          headers: await workspaceJsonHeaders(
            userId,
            workspaceId
          ),
          body: JSON.stringify({
            selected_dashboard: safeSelectedDashboard,
          }),
        }
      )
  } catch (error) {
    rethrowApiFetchError(
      error,
      "Dashboard preference service is unavailable."
    )
  }

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to update dashboard preference"
    )
  }

  return getSafeDashboardPreference(
    await response.json()
  )
}

export async function getDatasetPreference(
  userId: string,
  workspaceId?: string
): Promise<DatasetPreferenceResponse> {
  const cacheKey =
    `dataset-preference:${getWorkspaceCacheIdentity(
      userId,
      workspaceId
    )}`

  return getCachedRead(
    cacheKey,
    async () => {
      let response: Response

      try {
        response =
          await apiFetch(
            `${API_URL}/organizations/preferences/dataset`,
            {
              headers: await workspaceHeaders(
                userId,
                workspaceId
              ),
            }
          )
      } catch (error) {
        rethrowApiFetchError(
          error,
          "Dataset preference service is unavailable."
        )
      }

      if (!response.ok) {
        await throwApiError(
          response,
          "Failed to load dataset preference"
        )
      }

      return response.json()
    }
  )
}

export async function updateDatasetPreference(
  datasetId: number,
  userId: string,
  selectedMetric?: string,
  metricTargets?: Record<string, Record<string, number>>,
  dashboardPreferences?: Record<string, DashboardPreferencePayload>,
  workspaceId?: string
): Promise<DatasetPreferenceResponse> {
  const cleanDatasetId =
    cleanPositiveIntegerId(
      datasetId,
      "Dataset id"
    )

  const body: {
    dataset_id: number
    selected_metric?: string | null
    metric_targets?: Record<string, Record<string, number>>
    dashboard_preferences?: Record<string, DashboardPreferencePayload>
  } = {
    dataset_id: cleanDatasetId,
  }

  if (selectedMetric !== undefined) {
    body.selected_metric =
      selectedMetric.trim() || null
  }

  if (metricTargets !== undefined) {
    body.metric_targets =
      cleanMetricTargets(metricTargets)
  }

  if (dashboardPreferences !== undefined) {
    body.dashboard_preferences =
      cleanDashboardPreferences(
        dashboardPreferences
      )
  }

  const cacheKey =
    `dataset-preference:${getWorkspaceCacheIdentity(
      userId,
      workspaceId
    )}`

  return enqueueDatasetPreferenceWrite(
    cacheKey,
    async () => {
      const response =
        await apiFetch(
          `${API_URL}/organizations/preferences/dataset`,
          {
            method: "POST",
            headers: await workspaceJsonHeaders(
              userId,
              workspaceId
            ),
            body: JSON.stringify(body),
          }
        )

      if (!response.ok) {
        await throwApiError(
          response,
          "Failed to update dataset preference"
        )
      }

      invalidateApiReadCache([cacheKey])

      return response.json()
    }
  )
}

/* =========================
   Decision List API For Workspace Portfolio Filtering And Pagination
========================= */

export async function getDecisions(
  userId: string,
  workspaceId?: string,
  options?: DecisionListOptions
): Promise<DecisionRecord[]> {
  const response =
    await apiFetch(
      `${API_URL}/decisions${buildDecisionListQuery(
        options
      )}`,
      {
        headers: await decisionHeaders(
          userId,
          workspaceId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to load decisions"
    )
  }

  return response.json()
}

/* =========================
   Decision Portfolio Summary API For Metrics And Filter Counts
========================= */

export async function getDecisionSummary(
  userId: string,
  workspaceId?: string,
  datasetId?: number
): Promise<DecisionSummary> {
  const cleanDatasetId =
    datasetId === undefined
      ? undefined
      : cleanPositiveIntegerId(
          datasetId,
          "Dataset id"
        )
  const query = cleanDatasetId
    ? `?dataset_id=${cleanDatasetId}`
    : ""
  const response =
    await apiFetch(
      `${API_URL}/decisions/summary${query}`,
      {
        headers: await decisionHeaders(
          userId,
          workspaceId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to load decision summary"
    )
  }

  return response.json()
}

/* =========================
   Workspace Decision Activity Feed API For Recent Portfolio Changes
========================= */

export async function getDecisionActivityFeed(
  userId: string,
  workspaceId?: string,
  limit = 20,
  offset = 0
): Promise<DecisionActivityFeedItem[]> {
  const cleanLimit =
    cleanPaginationLimit(limit, 20)
  const cleanOffset =
    cleanPaginationOffset(offset)
  const params =
    new URLSearchParams({
      limit: String(cleanLimit),
      offset: String(cleanOffset),
    })

  const response =
    await apiFetch(
      `${API_URL}/decisions/activities?${params.toString()}`,
      {
        headers: await decisionHeaders(
          userId,
          workspaceId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to load decision activity feed"
    )
  }

  return response.json()
}

/* =========================
   Decision Create And Basic Status Update API
========================= */

export async function createDecision(
  payload: DecisionCreatePayload,
  userId: string,
  workspaceId?: string
): Promise<DecisionRecord> {
  const cleanPayload = {
    ...payload,
    dataset_id:
      cleanPositiveIntegerId(
        payload.dataset_id,
        "Dataset id"
      ),
  }

  const response =
    await apiFetch(
      `${API_URL}/decisions`,
      {
        method: "POST",

        headers: await decisionHeaders(
          userId,
          workspaceId
        ),

        body: JSON.stringify(
          cleanPayload
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to create decision"
    )
  }

  return response.json()
}

export async function updateDecision(
  decisionId: number,
  status: DecisionStatus,
  userId: string,
  workspaceId?: string
): Promise<DecisionRecord> {
  const cleanDecisionId =
    cleanPositiveIntegerId(
      decisionId,
      "Decision id"
    )

  const response =
    await apiFetch(
      `${API_URL}/decisions/${cleanDecisionId}`,
      {
        method: "PATCH",

        headers: await decisionHeaders(
          userId,
          workspaceId
        ),

        body: JSON.stringify({
          status,
        }),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to update decision"
    )
  }

  return response.json()
}

/* =========================
   Decision Detail Consolidated Edit API For Overview And Details Cards
========================= */

export async function updateDecisionOverview(
  decisionId: number,
  payload: DecisionOverviewPayload,
  userId: string,
  workspaceId?: string
): Promise<DecisionRecord> {
  const cleanDecisionId =
    cleanPositiveIntegerId(
      decisionId,
      "Decision id"
    )

  const response =
    await apiFetch(
      `${API_URL}/decisions/${cleanDecisionId}/overview`,
      {
        method: "PATCH",

        headers: await decisionHeaders(
          userId,
          workspaceId
        ),

        body: JSON.stringify(
          payload
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to update decision overview"
    )
  }

  return response.json()
}

export async function updateDecisionDetails(
  decisionId: number,
  payload: DecisionDetailsPayload,
  userId: string,
  workspaceId?: string
): Promise<DecisionRecord> {
  const cleanDecisionId =
    cleanPositiveIntegerId(
      decisionId,
      "Decision id"
    )

  const response =
    await apiFetch(
      `${API_URL}/decisions/${cleanDecisionId}/details`,
      {
        method: "PATCH",

        headers: await decisionHeaders(
          userId,
          workspaceId
        ),

        body: JSON.stringify(
          payload
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to update decision details"
    )
  }

  return response.json()
}

/* =========================
   Decision Detail Timeline API For One Decision
========================= */

export async function getDecisionActivities(
  decisionId: number,
  userId: string,
  workspaceId?: string,
  limit = 20,
  offset = 0
): Promise<DecisionActivity[]> {
  const cleanDecisionId =
    cleanPositiveIntegerId(
      decisionId,
      "Decision id"
    )
  const cleanLimit =
    cleanPaginationLimit(limit, 20)
  const cleanOffset =
    cleanPaginationOffset(offset)
  const params =
    new URLSearchParams({
      limit: String(cleanLimit),
      offset: String(cleanOffset),
    })

  const response =
    await apiFetch(
      `${API_URL}/decisions/${cleanDecisionId}/activities?${params.toString()}`,
      {
        headers: await decisionHeaders(
          userId,
          workspaceId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to load decision activities"
    )
  }

  return response.json()
}

/* =========================
   Decision Lifecycle API For Archive And Restore Actions
========================= */

export async function archiveDecision(
  decisionId: number,
  userId: string,
  workspaceId?: string
): Promise<DecisionRecord> {
  const cleanDecisionId =
    cleanPositiveIntegerId(
      decisionId,
      "Decision id"
    )

  const response =
    await apiFetch(
      `${API_URL}/decisions/${cleanDecisionId}/archive`,
      {
        method: "PATCH",
        headers: await decisionHeaders(
          userId,
          workspaceId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to archive decision"
    )
  }

  return response.json()
}

export async function restoreDecision(
  decisionId: number,
  userId: string,
  workspaceId?: string
): Promise<DecisionRecord> {
  const cleanDecisionId =
    cleanPositiveIntegerId(
      decisionId,
      "Decision id"
    )

  const response =
    await apiFetch(
      `${API_URL}/decisions/${cleanDecisionId}/restore`,
      {
        method: "PATCH",
        headers: await decisionHeaders(
          userId,
          workspaceId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to restore decision"
    )
  }

  return response.json()
}

/* =========================
   Decision Detail Read API For One Decision
========================= */

export async function getDecision(
  decisionId: number,
  userId: string,
  workspaceId?: string
): Promise<DecisionRecord> {
  const cleanDecisionId =
    cleanPositiveIntegerId(
      decisionId,
      "Decision id"
    )

  const response =
    await apiFetch(
      `${API_URL}/decisions/${cleanDecisionId}`,
      {
        headers: await decisionHeaders(
          userId,
          workspaceId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to load decision"
    )
  }

  return response.json()
}

export async function getDecisionOutcomeAnalysis(
  decisionId: number,
  userId: string,
  workspaceId?: string
): Promise<DecisionOutcomeAnalysisResponse> {
  const cleanDecisionId =
    cleanPositiveIntegerId(
      decisionId,
      "Decision id"
    )

  const response =
    await apiFetch(
      `${API_URL}/decisions/${cleanDecisionId}/outcome-analysis`,
      {
        headers: await decisionHeaders(
          userId,
          workspaceId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to generate decision outcome analysis"
    )
  }

  return response.json()
}

/* =========================
   Decision Detail Notes Outcome And Learning Edit API
========================= */

export async function updateDecisionNotes(
  decisionId: number,
  notes: string | null,
  userId: string,
  workspaceId?: string
): Promise<DecisionRecord> {
  const cleanDecisionId =
    cleanPositiveIntegerId(
      decisionId,
      "Decision id"
    )

  const response =
    await apiFetch(
      `${API_URL}/decisions/${cleanDecisionId}/notes`,
      {
        method: "PATCH",
        headers: await decisionHeaders(
          userId,
          workspaceId
        ),

        body: JSON.stringify({
          notes,
        }),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to update notes"
    )
  }

  return response.json()
}

export async function updateDecisionOutcome(
  decisionId: number,
  payload: DecisionOutcomePayload,
  userId: string,
  workspaceId?: string
): Promise<DecisionRecord> {
  const cleanDecisionId =
    cleanPositiveIntegerId(
      decisionId,
      "Decision id"
    )

  const response =
    await apiFetch(
      `${API_URL}/decisions/${cleanDecisionId}/outcome`,
      {
        method: "PATCH",

        headers: await decisionHeaders(
          userId,
          workspaceId
        ),

        body: JSON.stringify(
          payload
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to update outcome"
    )
  }

  return response.json()
}


export async function updateDecisionLearning(
  decisionId: number,
  lessonsLearned: string | null,
  userId: string,
  workspaceId?: string
): Promise<DecisionRecord> {
  const cleanDecisionId =
    cleanPositiveIntegerId(
      decisionId,
      "Decision id"
    )

  const response =
    await apiFetch(
      `${API_URL}/decisions/${cleanDecisionId}/learning`,
      {
        method: "PATCH",

        headers: await decisionHeaders(
          userId,
          workspaceId
        ),

        body: JSON.stringify({
          lessons_learned:
            lessonsLearned,
        }),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to update learning"
    )
  }

  return response.json()
}

/* =========================
   Legacy Single Field Decision Edit API For Older UI Calls
========================= */

export async function updateDecisionReviewDate(
  decisionId: number,
  reviewDate: string | null,
  userId: string,
  workspaceId?: string
): Promise<DecisionRecord> {
  const cleanDecisionId =
    cleanPositiveIntegerId(
      decisionId,
      "Decision id"
    )

  const response =
    await apiFetch(
      `${API_URL}/decisions/${cleanDecisionId}/review-date`,
      {
        method: "PATCH",
        headers: await decisionHeaders(
          userId,
          workspaceId
        ),
        body: JSON.stringify({
          review_date:
            reviewDate,
        }),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to update review date"
    )
  }

  return response.json()
}

export async function updateDecisionPriority(
  decisionId: number,
  priority: DecisionPriority,
  userId: string,
  workspaceId?: string
): Promise<DecisionRecord> {
  const cleanDecisionId =
    cleanPositiveIntegerId(
      decisionId,
      "Decision id"
    )

  const response =
    await apiFetch(
      `${API_URL}/decisions/${cleanDecisionId}/priority`,
      {
        method: "PATCH",

        headers: await decisionHeaders(
          userId,
          workspaceId
        ),

        body: JSON.stringify({
          priority,
        }),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to update priority"
    )
  }

  return response.json()
}

export async function updateDecisionCategory(
  decisionId: number,
  category: DecisionCategory,
  userId: string,
  workspaceId?: string
): Promise<DecisionRecord> {
  const cleanDecisionId =
    cleanPositiveIntegerId(
      decisionId,
      "Decision id"
    )

  const response =
    await apiFetch(
      `${API_URL}/decisions/${cleanDecisionId}/category`,
      {
        method: "PATCH",

        headers: await decisionHeaders(
          userId,
          workspaceId
        ),

        body: JSON.stringify({
          category,
        }),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to update category"
    )
  }

  return response.json()
}

export async function updateDecisionConfidence(
  decisionId: number,
  confidenceScore: DecisionConfidenceScore | null,
  userId: string,
  workspaceId?: string
): Promise<DecisionRecord> {
  const cleanDecisionId =
    cleanPositiveIntegerId(
      decisionId,
      "Decision id"
    )

  const response =
    await apiFetch(
      `${API_URL}/decisions/${cleanDecisionId}/confidence`,
      {
        method: "PATCH",
        headers: await decisionHeaders(
          userId,
          workspaceId
        ),
        body: JSON.stringify({
          confidence_score: confidenceScore,
        }),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to update decision confidence"
    )
  }

  return response.json()
}
