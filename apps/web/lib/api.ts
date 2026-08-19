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
  configuredApiUrl || "http://127.0.0.1:8000"
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
  mine?: boolean
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

export type SupportRequestPayload = {
  request_type: "support" | "bug" | "feature"
  requester_email: string
  subject: string
  message: string
  page_url?: string
}

export type SupportRequestResponse = {
  accepted: boolean
  message: string
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

export type DatasetJoinMetadata = {
  dataset_id: number
  file_name: string
  row_count: number
  columns: string[]
  date_columns: string[]
  numeric_columns: string[]
  default_date_column?: string | null
  date_range: {
    start?: string | null
    end?: string | null
  }
}

export type DatasetJoinSelection = {
  dataset_id: number
  date_column?: string
  metric_column?: string | null
}

export type DatasetJoinResult = {
  join_version?: number
  primary_dataset_id: number
  dataset_ids: number[]
  join_key: string
  join_type: "inner"
  period: DashboardAggregation
  aggregation_type: DashboardValueAggregation
  start_date?: string | null
  period_filter: ForecastPeriodFilter | "all"
  matched_period_count: number
  available_period_count: number
  coverage_percent: number
  datasets: Array<{
    dataset_id: number
    file_name: string
    date_column: string
    metric_column: string
    label: string
    column_type: "numeric" | "categorical"
    source_rows: number
    usable_rows: number
    period_count: number
  }>
  rows: Array<{
    period: string
    [key: string]: string | number | null
  }>
  decision_context: string
}

export type DatasetRelationshipSelection = {
  dataset_id: number
  date_column: string
  metric_column: string
}

export type DatasetRelationshipPayload = {
  name: string
  left: DatasetRelationshipSelection
  right: DatasetRelationshipSelection
  period: DashboardAggregation
  aggregation: DashboardValueAggregation
  method: "pearson" | "spearman"
  lag_mode: "automatic" | "manual"
  lag_periods: number
}

export type DatasetRelationship = {
  id?: number | null
  name: string
  left: DatasetRelationshipSelection
  right: DatasetRelationshipSelection
  left_dataset_name: string
  right_dataset_name: string
  period: DashboardAggregation
  aggregation: DashboardValueAggregation
  method: "pearson" | "spearman"
  lag_mode?: "automatic" | "manual"
  lag_periods: number
  matched_period_count: number
  correlation?: number | null
  relationship_strength: string
  direction: string
  association_summary?: string | null
  delay_description?: string | null
  lag_credibility?: "credible" | "limited_evidence" | "insufficient_data" | "manual" | "unknown"
  lag_candidates?: Array<{
    lag_periods: number
    matched_period_count: number
    correlation?: number | null
    neighbor_count?: number
    same_direction_neighbor_count?: number
    stability?: number
    credible?: boolean | null
    score?: number | null
  }>
  causation_disclaimer?: string
  evidence: Array<{
    period: string
    left_value?: number | null
    right_value?: number | null
  }>
  decision_context: string
  status: "ready" | "insufficient_data" | "unavailable"
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

export type DatasetMultiMetricSelection = {
  dataset_id: number
  date_column: string
  metric_column: string
  aggregation: DashboardValueAggregation
}

export type DatasetMultiMetricAnalysisPayload = {
  metrics: DatasetMultiMetricSelection[]
  start_date?: string
  period_filter: ForecastPeriodFilter | "all"
  grouping: DashboardAggregation
}

export type DatasetMultiMetricAnalysis = {
  period_filter: ForecastPeriodFilter | "all"
  grouping: DashboardAggregation
  start_date: string
  end_date: string
  metric_count: number
  period_count: number
  metrics: Array<{
    dataset_id: number
    dataset_name: string
    metric: string
    label: string
    aggregation: DashboardValueAggregation
    period_count: number
    total?: number | null
    average?: number | null
    minimum?: number | null
    maximum?: number | null
    first_value?: number | null
    last_value?: number | null
    change_percent?: number | null
  }>
  rows: Array<{
    period: string
    [key: string]: string | number | null
  }>
  decision_context: string
  ai_analysis: AIAnalysis
}

export type DatasetAnomalyPoint = {
  period: string
  value: number
  baseline: number
  deviation: number
  score: number
  direction: "high" | "low"
}

export type DatasetAnomalyMetric = {
  metric: string
  status: "ready" | "insufficient_data"
  observation_count: number
  anomaly_count: number
  method?:
    | "median_absolute_deviation"
    | "interquartile_range"
    | "standard_deviation"
    | "constant_series"
    | null
  threshold?: number | null
  baseline?: number | null
  spread?: number | null
  anomalies: DatasetAnomalyPoint[]
  message?: string | null
}

export type DatasetAnomaliesResponse = {
  dataset_id: number
  file_name: string
  status: "ready" | "insufficient_data" | "unavailable"
  message?: string | null
  date_column?: string | null
  metric?: string | null
  available_metrics: string[]
  period_filter: ForecastPeriodFilter | "all"
  start_date?: string | null
  aggregation: DashboardAggregation
  aggregation_type: DashboardValueAggregation
  sensitivity: "high" | "medium" | "low"
  minimum_observations: number
  method_description: string
  data_notes: string[]
  total_anomaly_count: number
  metrics: DatasetAnomalyMetric[]
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
  sync_enabled?: boolean
  sync_interval_hours?: number
  sync_time_of_day?: string | null
  sync_timezone?: string | null
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

export type DataSourceConnectionSchedulePayload = {
  enabled: boolean
  interval_hours: number
  time_of_day: string
  timezone: string
}

export type DataSourceConnectionSyncResult = {
  connection_id: number
  dataset_id: number
  workspace_id?: string | null
  source_type: string
  source_label: string
  source_config?: string | null
  file_name: string
  file_path: string
  row_count: number
  column_count: number
  report: Record<string, unknown>
}

export type DataSourceConnectionSyncPayload = {
  start_date?: string
  end_date?: string
  dimensions?: string[]
  metrics?: string[]
}

export type BillingStatus = {
  configured: boolean
  provider: string
  workspace_id: string
  plan: string
  status: string
  price_id?: string | null
  current_period_end?: string | null
  cancel_at_period_end: boolean
  customer_portal_available: boolean
  plan_name: string
  billing_model: "direct" | "agency"
  monthly_price_cents?: number | null
  included_client_workspaces?: number | null
  client_workspace_limit?: number | null
  client_workspaces_used: number
  additional_client_workspaces: number
  additional_client_workspace_price_cents: number
  additional_client_workspace_annual_price_cents: number
  additional_client_workspace_ai_credits: number
  additional_ai_credit_packs: number
  ai_credit_pack_size: number
  ai_credit_pack_configured: boolean
  included_ai_credits: number
  ai_credits_used: number
  ai_credits_remaining: number
  access_status: string
  access_allowed: boolean
  requires_billing_action: boolean
  grace_period_end?: string | null
  days_remaining?: number | null
  access_reason: string
  plan_options: BillingPlanOption[]
}

export type BillingAccessStatus = {
  workspace_id: string
  billing_workspace_id: string
  plan: string
  status: string
  access_allowed: boolean
  requires_billing_action: boolean
  current_period_end?: string | null
  grace_period_end?: string | null
  days_remaining?: number | null
  reason: string
}

export type BillingPlanOption = {
  plan: string
  name: string
  billing_model: "direct" | "agency"
  monthly_price_cents?: number | null
  annual_price_cents?: number | null
  included_client_workspaces?: number | null
  ai_credit_limit: number
  configured: boolean
  monthly_configured: boolean
  annual_configured: boolean
}

export type BillingCheckoutPayload = {
  plan?: string
  billing_interval?: "month" | "year"
  additional_client_workspaces?: number
  additional_ai_credit_packs?: number
}

export type BillingCheckoutResponse = {
  checkout_url: string
  session_id: string
}

export type BillingPortalResponse = {
  portal_url: string
}

export type OAuthStartResponse = {
  authorization_url: string
  source_type: string
  expires_in_seconds: number
}

export type DashboardAggregation =
  | "daily"
  | "weekly"
  | "quarterly"
  | "monthly"

export type DashboardValueAggregation =
  | "sum"
  | "avg"
  | "min"
  | "max"
  | "count"

export type ForecastPeriodFilter =
  | "1m"
  | "1q"
  | "6m"
  | "1y"
  | "2y"
  | "3y"
  | "5y"
  | "all"

export type ForecastQueryOptions = {
  startDate?: string
  periodFilter?: ForecastPeriodFilter
  aggregation?: DashboardAggregation
  aggregationType?: DashboardValueAggregation
}

export type DashboardPreferencePayload = {
  title?: string
  subtitle?: string
  selectedMetrics?: string[]
  aggregation?: DashboardAggregation
  aggregationType?: DashboardValueAggregation
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
  joinedDatasetResult?: DatasetJoinResult
}

export type DashboardMetricMapping = {
  primary?: string
  secondary?: string
  operationsValue?: string
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
  dashboard_dataset_ids?: Record<string, number> | null
  dashboard_views?: Record<
    string,
    Record<string, DashboardPreferencePayload>
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
  metric_targets: Record<string, number | null>
  relationship_focus: number[]
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
  target?: number | null
}

export type WeeklyReportDigestRelationship = {
  id: number
  name: string
  left_dataset_id: number
  right_dataset_id: number
  left_dataset_name: string
  right_dataset_name: string
  left_metric: string
  right_metric: string
  period: string
  aggregation: string
  method: string
  lag_mode?: "automatic" | "manual"
  lag_periods: number
  matched_period_count: number
  correlation?: number | null
  relationship_strength: string
  direction: string
  decision_context: string
  delay_description?: string | null
  lag_credibility?: string
}

export type AIAnalysis = {
  source: string
  model?: string | null
  metric?: string | null
  fallback_reason?:
    | "not_configured"
    | "unsupported_provider"
    | "provider_unavailable"
    | "credits_exhausted"
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
    successful_outcome_count: number
    partially_successful_outcome_count: number
    unsuccessful_outcome_count: number
    historical_success_rate?: number | null
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
  relationship_focus: number[]
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
  relationships: WeeklyReportDigestRelationship[]
  recommendations: string[]
  unavailable_datasets: string[]
  decision_template_url?: string | null
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

export type WeeklyReportDeliveryLog = {
  id: number
  status: "sent" | "test_sent" | "failed" | "test_failed" | "skipped"
  recipients: string[]
  subject: string
  delivered_count: number
  metrics_count: number
  error?: string | null
  attempted_at: string
}

export type WeeklyReportDeliveryConfig = {
  email_delivery_configured: boolean
  email_delivery_source?:
    | "workspace"
    | "decisionate"
    | "unconfigured"
  workspace_smtp_configured?: boolean
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

export type PlatformAdminOverview = {
  organization_count: number
  member_count: number
  dataset_count: number
  decision_count: number
  recommendation_count: number
  evaluated_recommendation_count: number
  successful_recommendation_count: number
  recommendation_success_rate?: number | null
  evaluated_decision_count: number
  lesson_count: number
  alert_delivery_count: number
  failed_alert_delivery_count: number
  usage_event_count: number
  alert_status?: {
    server_smtp_configured: boolean
    scheduler_configured: boolean
  }
  ai_status: AIStatus
  analytics_status: {
    engine?: string
    storage_format?: string
    error?: string
  }
}

export type PlatformAdminOrganization = {
  id: number
  name: string
  owner_user_id: string
  owner_email?: string | null
  created_at?: string | null
  plan: string
  subscription_status: string
  billing_expires_at?: string | null
  member_count: number
  dataset_count: number
  decision_count: number
  evaluated_decision_count: number
}

export type PlatformAdminUser = {
  clerk_user_id: string
  email?: string | null
  organization_count: number
  organization_names: string[]
  roles: string[]
  owner: boolean
  protected?: boolean
  platform_admin?: boolean
  platform_admin_permissions?: string[]
}

export type PlatformAdminPermissionDefinition = {
  key: string
  label: string
}

export type PlatformAdminAccessDetails = {
  allowed: boolean
  full_access: boolean
  permissions: string[]
  available_permissions: PlatformAdminPermissionDefinition[]
}

export type PlatformAdminAdministrator = {
  user_id: string
  email?: string | null
  permissions: string[]
}

export type PlatformAdminDeleteResponse = {
  deleted: boolean
  summary: Record<string, number>
}

export type PlatformAdminIdentityLink = {
  internal_user_id: string
}

export type PlatformAdminMember = {
  id: number
  clerk_user_id: string
  email?: string | null
  role: string
  created_at?: string | null
}

export type PlatformAdminInvite = {
  id: number
  email: string
  role: string
  status: string
  created_at?: string | null
}

export type PlatformAdminAuditEvent = {
  id: number
  admin_user_id: string
  organization_id?: number | null
  target_user_id?: string | null
  target_email?: string | null
  action: string
  details?: string | null
  created_at?: string | null
}

export type PlatformAdminAlertDelivery = {
  id: number
  workspace_id: string
  organization_name?: string | null
  status: string
  recipients: string[]
  subject: string
  delivered_count: number
  metrics_count: number
  error?: string | null
  attempted_at?: string | null
}

export type PlatformAdminUsageRoute = {
  route: string
  method: string
  event_count: number
  successful_count: number
  failed_count: number
}

export type PlatformAdminUsageEvent = {
  id: number
  actor_user_id?: string | null
  workspace_id?: string | null
  organization_name?: string | null
  route: string
  method: string
  status_code: number
  duration_ms: number
  created_at?: string | null
}

export type PlatformAdminAICreditSegment = {
  segment: string
  credits: number
  requests: number
  active_users: number
  workspaces: number
}

export type PlatformAdminAICreditUser = {
  user_id: string
  segment: string
  credits: number
  requests: number
  workspaces: number
  attributed: boolean
}

export type PlatformAdminAICreditWorkspace = {
  workspace_id: string
  organization_name?: string | null
  segment: string
  credits: number
  requests: number
  active_users: number
}

export type PlatformAdminUsage = {
  period_days: number
  period_start: string
  period_end: string
  total_events: number
  successful_events: number
  failed_events: number
  active_users: number
  active_workspaces: number
  average_duration_ms: number
  ai_requests: number
  ai_tokens: number
  ai_credits: number
  ai_credit_segments: PlatformAdminAICreditSegment[]
  ai_credit_users: PlatformAdminAICreditUser[]
  ai_credit_workspaces: PlatformAdminAICreditWorkspace[]
  top_routes: PlatformAdminUsageRoute[]
  recent_events: PlatformAdminUsageEvent[]
}

export type PlatformAdminEmailSettings = {
  configured: boolean
  source: "database" | "environment" | "unconfigured"
  provider: "smtp" | "resend"
  resend_from_email: string
  resend_from_name: string
  resend_api_key_set: boolean
  smtp_host: string
  smtp_port: number
  smtp_username: string
  smtp_password_set: boolean
  smtp_from_email: string
  smtp_from_name: string
  smtp_use_tls: boolean
  smtp_use_ssl: boolean
  smtp_timeout_seconds: number
}

export type PlatformAdminEmailSettingsUpdate = {
  provider: "smtp" | "resend"
  resend_api_key?: string
  clear_resend_api_key?: boolean
  resend_from_email: string
  resend_from_name: string
  smtp_host: string
  smtp_port: number
  smtp_username: string
  smtp_password?: string
  clear_password?: boolean
  smtp_from_email: string
  smtp_from_name: string
  smtp_use_tls: boolean
  smtp_use_ssl: boolean
}

export type PlatformAdminCreditSettings = {
  source: "database" | "environment/default"
  free_ai_credits: number
  professional_ai_credits: number
  agency_ai_credits: number
  agency_client_ai_credits: number
  additional_client_workspace_ai_credits: number
  ai_credit_pack_size: number
  updated_at?: string | null
}

export type PlatformAdminCreditSettingsUpdate = Partial<
  Omit<PlatformAdminCreditSettings, "source" | "updated_at">
>

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
    selected_metric?: string | null
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
        aggregationType?: DashboardValueAggregation
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
        joinedDatasetResult?: DatasetJoinResult
      }
    > | null
    dashboard_views?: Record<
      string,
      Record<string, DashboardPreferencePayload>
    > | null
    joined_dataset_result?: DatasetJoinResult | null
  }
  decision_summary?: DecisionSummary | null
}

export type PublicDemoDatasetOption = {
  key: string
  label: string
  source_type: string
  row_count: number
}

export type PublicDemoDashboardResponse =
  PublicSharedDashboardResponse & {
    demo: true
    demo_datasets: PublicDemoDatasetOption[]
    selected_dataset: string
    selected_dashboard: string
    capabilities: {
      can_create_decisions: false
      can_upload: false
      can_delete_datasets: false
    }
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
  | "delete"
  | "export"

export type DecisionRecord = {
  id: number
  workspace_id?: string | null
  owner_user_id?: string | null
  dataset_id: number
  metric_column?: string | null
  recommendation_text?: string | null
  recommendation_source?: string | null
  recommendation_context?: string | null
  title: string
  action?: string | null
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

export type DecisionLifecycleAccess = {
  owner_user_id: string
  is_decision_owner: boolean
  is_workspace_owner: boolean
  can_archive: boolean
  can_delete: boolean
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
  decision_id: number | null
  workspace_id?: string | null
  actor_user_id?: string | null
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
  recommendation_source?: string | null
  recommendation_context?: string | null
  title: string
  action?: string | null
  description?: string
  expected_outcome: string
  priority?: DecisionPriority
  category?: DecisionCategory
  confidence_score?: DecisionConfidenceScore
  review_date?: string
}

export type DecisionTemplate = {
  slug: string
  name: string
  description: string
  category: DecisionCategory
  priority: DecisionPriority
  confidence_score: DecisionConfidenceScore
  title_template: string
  decision_description: string
  expected_outcome: string
  review_days: number
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
  action?: string | null
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
  owner_user_id?: string | null
  logo_url?: string | null
  primary_color?: string | null
  accent_color?: string | null
  report_display_name?: string | null
  agency_owner_access_enabled?: boolean
  billing_notice?: string | null
}

export type OrganizationBrandingPayload = {
  name: string
  logo_url?: string | null
  primary_color?: string | null
  accent_color?: string | null
  report_display_name?: string | null
}

export type OrganizationCreatePayload =
  OrganizationBrandingPayload & {
    plan?: "professional" | "agency"
  }

export type OrganizationWorkspaceRecord = {
  id: number
  name: string
  owner_user_id: string
  role: "owner" | "member" | "client" | "managed_client" | string
  logo_url?: string | null
  primary_color?: string | null
  accent_color?: string | null
  report_display_name?: string | null
  agency_owner_access_enabled?: boolean
  billing_notice?: string | null
}

export type ClientWorkspaceCreatePayload = {
  name: string
  client_email: string
}

export type OrganizationMemberRecord = {
  id: number
  organization_id: number
  clerk_user_id: string
  role: string
  email?: string | null
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
  workspaceId?: string,
  userEmail?: string
) {
  const cleanUserId =
    cleanHeaderIdentity(userId)
  const activeWorkspaceId =
    cleanHeaderIdentity(
      workspaceId,
      getActiveWorkspaceId(cleanUserId)
    )

  const headers: Record<string, string> = {
      "X-User-Id":
        cleanUserId,
      "X-Workspace-Id":
        activeWorkspaceId,
  }
  const cleanUserEmail = userEmail?.trim()
  if (cleanUserEmail) {
    headers["X-User-Email"] = cleanUserEmail
  }

  return withAuthorizationHeader(headers)
}

async function workspaceJsonHeaders(
  userId: string,
  workspaceId?: string,
  userEmail?: string
) {
  const cleanUserId =
    cleanHeaderIdentity(userId)
  const activeWorkspaceId =
    cleanHeaderIdentity(
      workspaceId,
      getActiveWorkspaceId(cleanUserId)
    )

  const headers: Record<string, string> = {
      "Content-Type":
        "application/json",
      "X-User-Id":
        cleanUserId,
      "X-Workspace-Id":
        activeWorkspaceId,
  }
  const cleanUserEmail = userEmail?.trim()
  if (cleanUserEmail) {
    headers["X-User-Email"] = cleanUserEmail
  }

  return withAuthorizationHeader(headers)
}

/* =========================
   Organization Owner Headers For Settings And Workspace Switching
========================= */

async function organizationOwnerHeaders(
  userId: string,
  userEmail?: string
) {
  return workspaceHeaders(
    userId,
    userId,
    userEmail
  )
}

async function organizationOwnerJsonHeaders(
  userId: string,
  userEmail?: string
) {
  return workspaceJsonHeaders(
    userId,
    userId,
    userEmail
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

  if (
    isDashboardValueAggregation(
      preference.aggregationType
    )
  ) {
    cleanPreference.aggregationType =
      preference.aggregationType
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

  if (
    preference.joinedDatasetResult &&
    typeof preference.joinedDatasetResult === "object" &&
    !Array.isArray(preference.joinedDatasetResult)
  ) {
    cleanPreference.joinedDatasetResult =
      preference.joinedDatasetResult as DatasetJoinResult
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
          "secondary",
          "operationsValue",
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

function isDashboardValueAggregation(
  value: unknown
): value is DashboardValueAggregation {
  return (
    value === "sum" ||
    value === "avg" ||
    value === "min" ||
    value === "max" ||
    value === "count"
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

  if (options.mine) {
    params.set(
      "mine",
      "true"
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
          workspaceId ?? userId
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

export type SignedUrlDatasetImportPayload = {
  url: string
  file_name?: string
}

export async function importDatasetFromSignedUrl(
  payload: SignedUrlDatasetImportPayload,
  userId: string,
  workspaceId?: string
) {
  const response = await apiFetch(
    `${API_URL}/datasets/import-url`,
    {
      method: "POST",
      headers: await workspaceJsonHeaders(
        userId,
        workspaceId ?? userId
      ),
      body: JSON.stringify(payload),
    }
  )

  if (!response.ok) {
    await throwApiError(
      response,
      "Cloud file import failed"
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

export async function getDatasetJoinMetadata(
  datasetIds: number[],
  userId: string,
  workspaceId?: string
): Promise<{ datasets: DatasetJoinMetadata[] }> {
  const cleanDatasetIds = Array.from(
    new Set(
      datasetIds
        .map(datasetId =>
          cleanPositiveIntegerId(
            datasetId,
            "Dataset id"
          )
        )
    )
  )
  const params = new URLSearchParams()
  cleanDatasetIds.forEach(datasetId =>
    params.append("dataset_ids", String(datasetId))
  )

  const response = await apiFetch(
    `${API_URL}/datasets/join/metadata?${params.toString()}`,
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
      "Failed to load dataset join metadata"
    )
  }

  return response.json()
}

export async function joinDatasets(
  payload: {
    selections: DatasetJoinSelection[]
    start_date?: string
    period_filter: ForecastPeriodFilter | "all"
    aggregation: DashboardAggregation
    aggregation_type: DashboardValueAggregation
    dashboard_key?: string
  },
  userId: string,
  workspaceId?: string
): Promise<DatasetJoinResult> {
  const response = await apiFetch(
    `${API_URL}/datasets/join`,
    {
      method: "POST",
      headers: await workspaceJsonHeaders(
        userId,
        workspaceId
      ),
      body: JSON.stringify(payload),
    }
  )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to join datasets"
    )
  }

  return response.json()
}

export async function previewDatasetRelationship(
  payload: DatasetRelationshipPayload,
  userId: string,
  workspaceId?: string
): Promise<DatasetRelationship> {
  const response = await apiFetch(
    `${API_URL}/datasets/relationships/preview`,
    {
      method: "POST",
      headers: await workspaceJsonHeaders(
        userId,
        workspaceId
      ),
      body: JSON.stringify(payload),
    }
  )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to calculate dataset relationship"
    )
  }

  return response.json()
}

export async function createDatasetRelationship(
  payload: DatasetRelationshipPayload,
  userId: string,
  workspaceId?: string
): Promise<DatasetRelationship> {
  const response = await apiFetch(
    `${API_URL}/datasets/relationships`,
    {
      method: "POST",
      headers: await workspaceJsonHeaders(
        userId,
        workspaceId
      ),
      body: JSON.stringify(payload),
    }
  )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to save dataset relationship"
    )
  }

  return response.json()
}

export async function getDatasetRelationships(
  userId: string,
  workspaceId?: string
): Promise<DatasetRelationship[]> {
  const response = await apiFetch(
    `${API_URL}/datasets/relationships`,
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
      "Failed to load dataset relationships"
    )
  }

  return response.json()
}

export async function deleteDatasetRelationship(
  relationshipId: number,
  userId: string,
  workspaceId?: string
): Promise<{ deleted: boolean }> {
  const response = await apiFetch(
    `${API_URL}/datasets/relationships/${relationshipId}`,
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
      "Failed to delete dataset relationship"
    )
  }

  return response.json()
}

export async function getDatasetJoinCache(
  datasetId: number,
  dashboardKey: string,
  userId: string,
  workspaceId?: string
): Promise<DatasetJoinResult | null> {
  const params = new URLSearchParams({
    dataset_id: String(
      cleanPositiveIntegerId(
        datasetId,
        "Dataset id"
      )
    ),
    dashboard: dashboardKey,
  })
  const response = await apiFetch(
    `${API_URL}/datasets/join/cache?${params.toString()}`,
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
      "Failed to load the joined dataset cache"
    )
  }

  return response.json()
}

export async function deleteDatasetJoinCache(
  datasetId: number,
  dashboardKey: string,
  userId: string,
  workspaceId?: string
) {
  const params = new URLSearchParams({
    dataset_id: String(
      cleanPositiveIntegerId(
        datasetId,
        "Dataset id"
      )
    ),
    dashboard: dashboardKey,
  })
  const response = await apiFetch(
    `${API_URL}/datasets/join/cache?${params.toString()}`,
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
      "Failed to reset the joined dataset cache"
    )
  }

  return response.json()
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
          workspaceId ?? userId
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

export async function getWeeklyReportDeliveryHistory(
  userId: string,
  workspaceId?: string,
  limit = 20
): Promise<WeeklyReportDeliveryLog[]> {
  const response =
    await apiFetch(
      `${API_URL}/alerts/weekly-report/delivery-history?limit=${limit}`,
      {
        headers: await workspaceHeaders(
          userId,
          workspaceId
        ),
        cache: "no-store",
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to load weekly report delivery history"
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

export async function getPlatformAdminOverview(
  userId: string
): Promise<PlatformAdminOverview> {
  const response =
    await apiFetch(
      `${API_URL}/admin/overview`,
      {
        headers: await workspaceHeaders(
          userId,
          userId
        ),
        cache: "no-store",
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Platform admin access is unavailable"
    )
  }

  return response.json()
}

export async function getPlatformAdminEmailSettings(
  userId: string
): Promise<PlatformAdminEmailSettings> {
  const response =
    await apiFetch(
      `${API_URL}/admin/email-settings`,
      {
        headers: await workspaceHeaders(
          userId,
          userId
        ),
        cache: "no-store",
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Decisionate email settings are unavailable"
    )
  }

  return response.json()
}

export async function updatePlatformAdminEmailSettings(
  userId: string,
  payload: PlatformAdminEmailSettingsUpdate
): Promise<PlatformAdminEmailSettings> {
  const response =
    await apiFetch(
      `${API_URL}/admin/email-settings`,
      {
        method: "PATCH",
        headers: await workspaceJsonHeaders(
          userId,
          userId
        ),
        body: JSON.stringify(payload),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Decisionate email settings could not be saved"
    )
  }

  return response.json()
}

export async function getPlatformAdminCreditSettings(
  userId: string
): Promise<PlatformAdminCreditSettings> {
  const response =
    await apiFetch(
      `${API_URL}/admin/credit-settings`,
      {
        headers: await workspaceHeaders(
          userId,
          userId
        ),
        cache: "no-store",
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Decisionate credit settings are unavailable"
    )
  }

  return response.json()
}

export async function updatePlatformAdminCreditSettings(
  userId: string,
  payload: PlatformAdminCreditSettingsUpdate
): Promise<PlatformAdminCreditSettings> {
  const response =
    await apiFetch(
      `${API_URL}/admin/credit-settings`,
      {
        method: "PATCH",
        headers: await workspaceJsonHeaders(
          userId,
          userId
        ),
        body: JSON.stringify(payload),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Decisionate credit settings could not be saved"
    )
  }

  return response.json()
}

export async function getPlatformAdminAccess(
  userId: string
): Promise<boolean> {
  const response =
    await apiFetch(
      `${API_URL}/admin/access`,
      {
        headers: await workspaceHeaders(
          userId,
          userId
        ),
        cache: "no-store",
      }
    )

  if (!response.ok) {
    return false
  }

  const payload = await response.json() as {
    allowed?: boolean
  }
  return payload.allowed === true
}

export async function getPlatformAdminAccessDetails(
  userId: string
): Promise<PlatformAdminAccessDetails> {
  const response =
    await apiFetch(
      `${API_URL}/admin/access`,
      {
        headers: await workspaceHeaders(
          userId,
          userId
        ),
        cache: "no-store",
      }
    )

  if (!response.ok) {
    return {
      allowed: false,
      full_access: false,
      permissions: [],
      available_permissions: [],
    }
  }

  return response.json()
}

export async function addPlatformAdminAdministrators(
  userId: string,
  userReferences: string[],
  permissions: string[]
): Promise<PlatformAdminAdministrator[]> {
  const response =
    await apiFetch(
      `${API_URL}/admin/administrators`,
      {
        method: "POST",
        headers: await workspaceJsonHeaders(
          userId,
          userId
        ),
        body: JSON.stringify({
          user_references: userReferences,
          permissions,
        }),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Platform admin access could not be saved"
    )
  }

  const payload = await response.json()
  return payload.administrators ?? []
}

export async function getPlatformAdminOrganizations(
  userId: string
): Promise<PlatformAdminOrganization[]> {
  const response =
    await apiFetch(
      `${API_URL}/admin/organizations`,
      {
        headers: await workspaceHeaders(
          userId,
          userId
        ),
        cache: "no-store",
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Platform organizations are unavailable"
    )
  }

  return response.json()
}

export async function createPlatformAdminOrganization(
  userId: string,
  payload: {
    name: string
    owner_email: string
    plan: string
    billing_expires_at?: string | null
    member_emails?: string[]
  }
): Promise<PlatformAdminOrganization> {
  const response =
    await apiFetch(
      `${API_URL}/admin/organizations`,
      {
        method: "POST",
        headers: await workspaceJsonHeaders(
          userId,
          userId
        ),
        body: JSON.stringify(payload),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Workspace could not be provisioned"
    )
  }

  return response.json()
}

export async function updatePlatformAdminOrganizationSubscription(
  userId: string,
  organizationId: number,
  payload: {
    plan: string
    billing_expires_at?: string | null
  }
): Promise<PlatformAdminOrganization> {
  const response =
    await apiFetch(
      `${API_URL}/admin/organizations/${organizationId}/subscription`,
      {
        method: "PATCH",
        headers: await workspaceJsonHeaders(
          userId,
          userId
        ),
        body: JSON.stringify(payload),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Workspace billing could not be updated"
    )
  }

  return response.json()
}

export async function getPlatformAdminUsers(
  userId: string,
  search?: string,
  limit = 100,
  userEmail?: string
): Promise<PlatformAdminUser[]> {
  const params = new URLSearchParams({
    limit: String(limit),
  })
  if (search?.trim()) {
    params.set("search", search.trim())
  }

  const response =
    await apiFetch(
      `${API_URL}/admin/users?${params.toString()}`,
      {
        headers: await workspaceHeaders(
          userId,
          userId,
          userEmail
        ),
        cache: "no-store",
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Platform users are unavailable"
    )
  }

  return response.json()
}

export async function linkPlatformAdminIdentity(
  userId: string,
  targetUserId: string
): Promise<PlatformAdminIdentityLink> {
  const response =
    await apiFetch(
      `${API_URL}/admin/identity-links`,
      {
        method: "POST",
        headers: await workspaceJsonHeaders(
          userId,
          userId
        ),
        body: JSON.stringify({
          target_user_id: targetUserId,
        }),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Provider identity could not be linked"
    )
  }

  return response.json()
}

export async function deletePlatformAdminOrganization(
  userId: string,
  organizationId: number
): Promise<PlatformAdminDeleteResponse> {
  const response =
    await apiFetch(
      `${API_URL}/admin/organizations/${organizationId}/delete`,
      {
        method: "POST",
        headers: await workspaceJsonHeaders(
          userId,
          userId
        ),
        body: JSON.stringify({
          confirmation: "DELETE WORKSPACE",
        }),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Workspace could not be deleted"
    )
  }

  return response.json()
}

export async function deletePlatformAdminUser(
  userId: string,
  targetUserId: string
): Promise<PlatformAdminDeleteResponse> {
  const response =
    await apiFetch(
      `${API_URL}/admin/users/delete`,
      {
        method: "POST",
        headers: await workspaceJsonHeaders(
          userId,
          userId
        ),
        body: JSON.stringify({
          user_id: targetUserId,
          confirmation: "DELETE USER",
        }),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "User could not be deleted"
    )
  }

  return response.json()
}

export async function getPlatformAdminAuditEvents(
  userId: string,
  limit = 0
): Promise<PlatformAdminAuditEvent[]> {
  const response =
    await apiFetch(
      `${API_URL}/admin/audit-events?limit=${limit}`,
      {
        headers: await workspaceHeaders(
          userId,
          userId
        ),
        cache: "no-store",
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Platform admin audit history is unavailable"
    )
  }

  return response.json()
}

export async function getPlatformAdminAlertDeliveries(
  userId: string,
  status?: string,
  limit = 0
): Promise<PlatformAdminAlertDelivery[]> {
  const params = new URLSearchParams({
    limit: String(limit),
  })
  if (status) {
    params.set("status", status)
  }

  const response =
    await apiFetch(
      `${API_URL}/admin/alert-deliveries?${params.toString()}`,
      {
        headers: await workspaceHeaders(
          userId,
          userId
        ),
        cache: "no-store",
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Platform alert delivery history is unavailable"
    )
  }

  return response.json()
}

export async function getPlatformAdminUsageActivity(
  userId: string,
  days = 30,
  limit = 0
): Promise<PlatformAdminUsage> {
  const params = new URLSearchParams({
    days: String(days),
    limit: String(limit),
  })
  const response =
    await apiFetch(
      `${API_URL}/admin/usage-activity?${params.toString()}`,
      {
        headers: await workspaceHeaders(
          userId,
          userId
        ),
        cache: "no-store",
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Platform usage activity is unavailable"
    )
  }

  return response.json()
}

export async function getPlatformAdminOrganizationMembers(
  userId: string,
  organizationId: number
): Promise<PlatformAdminMember[]> {
  const response =
    await apiFetch(
      `${API_URL}/admin/organizations/${organizationId}/members`,
      {
        headers: await workspaceHeaders(
          userId,
          userId
        ),
        cache: "no-store",
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Platform organization members are unavailable"
    )
  }

  return response.json()
}

export async function getPlatformAdminOrganizationInvites(
  userId: string,
  organizationId: number
): Promise<PlatformAdminInvite[]> {
  const response =
    await apiFetch(
      `${API_URL}/admin/organizations/${organizationId}/invites`,
      {
        headers: await workspaceHeaders(
          userId,
          userId
        ),
        cache: "no-store",
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Platform organization invites are unavailable"
    )
  }

  return response.json()
}

export async function addPlatformAdminOrganizationInvite(
  userId: string,
  organizationId: number,
  email: string,
  role: "member" | "client"
): Promise<PlatformAdminInvite> {
  const response =
    await apiFetch(
      `${API_URL}/admin/organizations/${organizationId}/invites`,
      {
        method: "POST",
        headers: await workspaceJsonHeaders(
          userId,
          userId
        ),
        body: JSON.stringify({ email, role }),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Platform invite could not be created"
    )
  }

  return response.json()
}

export async function removePlatformAdminOrganizationInvite(
  userId: string,
  organizationId: number,
  inviteId: number
): Promise<void> {
  const response =
    await apiFetch(
      `${API_URL}/admin/organizations/${organizationId}/invites/${inviteId}`,
      {
        method: "DELETE",
        headers: await workspaceHeaders(
          userId,
          userId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Platform invite could not be removed"
    )
  }
}

export async function updatePlatformAdminMemberRole(
  userId: string,
  organizationId: number,
  memberId: number,
  role: "member" | "client"
): Promise<PlatformAdminMember> {
  const response =
    await apiFetch(
      `${API_URL}/admin/organizations/${organizationId}/members/${memberId}`,
      {
        method: "PATCH",
        headers: await workspaceJsonHeaders(
          userId,
          userId
        ),
        body: JSON.stringify({ role }),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Platform member role could not be updated"
    )
  }

  return response.json()
}

export async function addPlatformAdminMember(
  userId: string,
  organizationId: number,
  clerkUserId: string,
  role: "member" | "client"
): Promise<PlatformAdminMember> {
  const response =
    await apiFetch(
      `${API_URL}/admin/organizations/${organizationId}/members`,
      {
        method: "POST",
        headers: await workspaceJsonHeaders(
          userId,
          userId
        ),
        body: JSON.stringify({
          clerk_user_id: clerkUserId,
          role,
        }),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Platform member could not be added"
    )
  }

  return response.json()
}

export async function removePlatformAdminMember(
  userId: string,
  organizationId: number,
  memberId: number
): Promise<void> {
  const response =
    await apiFetch(
      `${API_URL}/admin/organizations/${organizationId}/members/${memberId}`,
      {
        method: "DELETE",
        headers: await workspaceHeaders(
          userId,
          userId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Platform member could not be removed"
    )
  }
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
          workspaceId ?? userId
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
          workspaceId ?? userId
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

export async function syncDataSourceConnection(
  connectionId: number,
  userId: string,
  workspaceId?: string,
  payload: DataSourceConnectionSyncPayload = {}
): Promise<DataSourceConnectionSyncResult> {
  const cleanConnectionId =
    cleanPositiveIntegerId(
      connectionId,
      "Connection id"
    )

  const response =
    await apiFetch(
      `${API_URL}/datasets/source-connections/${cleanConnectionId}/sync`,
      {
        method: "POST",
        headers: await workspaceJsonHeaders(
          userId,
          workspaceId
        ),
        body: JSON.stringify(payload),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to sync connector data"
    )
  }

  return response.json()
}

export async function updateDataSourceConnectionSchedule(
  connectionId: number,
  payload: DataSourceConnectionSchedulePayload,
  userId: string,
  workspaceId?: string
): Promise<DataSourceConnection> {
  const cleanConnectionId =
    cleanPositiveIntegerId(
      connectionId,
      "Connection id"
    )
  const response = await apiFetch(
    `${API_URL}/datasets/source-connections/${cleanConnectionId}/schedule`,
    {
      method: "PATCH",
      headers: await workspaceJsonHeaders(
        userId,
        workspaceId
      ),
      body: JSON.stringify(payload),
    }
  )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to update connector schedule"
    )
  }

  return response.json()
}

export async function startOAuthConnection(
  connectionId: number,
  userId: string,
  workspaceId?: string
): Promise<OAuthStartResponse> {
  const cleanConnectionId =
    cleanPositiveIntegerId(
      connectionId,
      "Connection id"
    )
  const response = await apiFetch(
    `${API_URL}/oauth/connections/${cleanConnectionId}/start`,
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
      "Failed to start connector authorization"
    )
  }

  return response.json()
}

export async function getBillingStatus(
  userId: string,
  workspaceId?: string
): Promise<BillingStatus> {
  const response = await apiFetch(
    `${API_URL}/billing`,
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
      "Failed to load billing status"
    )
  }

  return response.json()
}

export async function getBillingAccessStatus(
  userId: string,
  workspaceId?: string
): Promise<BillingAccessStatus> {
  const response = await apiFetch(
    `${API_URL}/billing/access`,
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
      "Failed to load subscription access"
    )
  }

  return response.json()
}

export async function createBillingCheckout(
  userId: string,
  workspaceId?: string,
  payload: BillingCheckoutPayload = {}
): Promise<BillingCheckoutResponse> {
  const response = await apiFetch(
    `${API_URL}/billing/checkout`,
    {
      method: "POST",
      headers: await workspaceJsonHeaders(
        userId,
        workspaceId
      ),
      body: JSON.stringify(payload),
    }
  )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to start billing checkout"
    )
  }

  return response.json()
}

export async function createBillingPortal(
  userId: string,
  workspaceId?: string
): Promise<BillingPortalResponse> {
  const response = await apiFetch(
    `${API_URL}/billing/portal`,
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
      "Failed to open billing portal"
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
          workspaceId ?? userId
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
    startDate?: string
    periodFilter?: ForecastPeriodFilter
    aggregation?: DashboardAggregation
    aggregationType?: DashboardValueAggregation
  }
) {
  const cleanDatasetId =
    cleanPositiveIntegerId(
      id,
      "Dataset id"
    )

  const queryParams = new URLSearchParams()

  if (options?.includeAllRows) {
    queryParams.set("include_all_rows", "true")
  }

  if (options?.startDate) {
    queryParams.set("start_date", options.startDate)
  }

  if (options?.periodFilter) {
    queryParams.set("period_filter", options.periodFilter)
  }

  if (options?.aggregation) {
    queryParams.set("aggregation", options.aggregation)
  }

  if (options?.aggregationType) {
    queryParams.set(
      "aggregation_type",
      options.aggregationType
    )
  }

  const queryString = queryParams.toString()
  const query = queryString
    ? `?${queryString}`
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

export async function getDatasetAnomalies(
  id: number,
  userId: string,
  workspaceId?: string,
  options?: {
    metric?: string
    dateColumn?: string
    startDate?: string
    periodFilter?: ForecastPeriodFilter
    aggregation?: DashboardAggregation
    aggregationType?: DashboardValueAggregation
    sensitivity?: "high" | "medium" | "low"
  }
): Promise<DatasetAnomaliesResponse> {
  const cleanDatasetId =
    cleanPositiveIntegerId(
      id,
      "Dataset id"
    )
  const queryParams = new URLSearchParams()

  if (options?.metric) {
    queryParams.set("metric", options.metric)
  }

  if (options?.dateColumn) {
    queryParams.set(
      "date_column",
      options.dateColumn
    )
  }

  if (options?.startDate) {
    queryParams.set(
      "start_date",
      options.startDate
    )
  }

  if (options?.periodFilter) {
    queryParams.set(
      "period_filter",
      options.periodFilter
    )
  }

  if (options?.aggregation) {
    queryParams.set(
      "aggregation",
      options.aggregation
    )
  }

  if (options?.aggregationType) {
    queryParams.set(
      "aggregation_type",
      options.aggregationType
    )
  }

  if (options?.sensitivity) {
    queryParams.set(
      "sensitivity",
      options.sensitivity
    )
  }

  const queryString = queryParams.toString()
  const query = queryString
    ? `?${queryString}`
    : ""

  const response =
    await apiFetch(
      `${API_URL}/datasets/${cleanDatasetId}/anomalies${query}`,
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
      "Failed to detect dataset anomalies"
    )
  }

  return response.json()
}

export async function getDatasetAIAnalysis(
  id: number,
  userId: string,
  workspaceId?: string,
  metric?: string,
  options?: {
    startDate?: string
    periodFilter?: ForecastPeriodFilter
    aggregation?: DashboardAggregation
    aggregationType?: DashboardValueAggregation
  }
): Promise<DatasetAIAnalysisResponse> {
  const cleanDatasetId =
    cleanPositiveIntegerId(
      id,
      "Dataset id"
    )
  const cleanMetric = metric?.trim()
  const queryParams = new URLSearchParams()

  if (cleanMetric) {
    queryParams.set("metric", cleanMetric)
  }

  if (options?.startDate) {
    queryParams.set("start_date", options.startDate)
  }

  if (options?.periodFilter) {
    queryParams.set("period_filter", options.periodFilter)
  }

  if (options?.aggregation) {
    queryParams.set("aggregation", options.aggregation)
  }

  if (options?.aggregationType) {
    queryParams.set(
      "aggregation_type",
      options.aggregationType
    )
  }

  const queryString = queryParams.toString()
  const query = queryString
    ? `?${queryString}`
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

export async function analyzeMultipleDatasetMetrics(
  payload: DatasetMultiMetricAnalysisPayload,
  userId: string,
  workspaceId?: string
): Promise<DatasetMultiMetricAnalysis> {
  const response = await apiFetch(
    `${API_URL}/datasets/multi-metric-analysis`,
    {
      method: "POST",
      headers: await workspaceJsonHeaders(userId, workspaceId),
      body: JSON.stringify(payload),
    }
  )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to analyze selected metrics"
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

    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      await throwApiError(
        response,
        "Failed to load performance dashboard"
      )
    }

    return await response.json()
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

}

export async function getPublicDemoDashboard(
  datasetKey: string,
  dashboard?: string,
  signal?: AbortSignal
): Promise<PublicDemoDashboardResponse | null> {
  const cleanDatasetKey = datasetKey.trim()
  if (!cleanDatasetKey) {
    return null
  }

  const params = new URLSearchParams({
    dataset: cleanDatasetKey,
  })
  if (dashboard?.trim()) {
    params.set("dashboard", dashboard.trim())
  }

  const requestController = new AbortController()
  let timedOut = false
  const timeoutId = setTimeout(() => {
    timedOut = true
    requestController.abort()
  }, apiRequestTimeoutMs)
  const abortRequest = () => requestController.abort()

  if (signal) {
    if (signal.aborted) {
      requestController.abort()
    } else {
      signal.addEventListener("abort", abortRequest, { once: true })
    }
  }

  try {
    const response = await fetch(
      `${API_URL}/public/demo?${params.toString()}`,
      {
        cache: "no-store",
        signal: requestController.signal,
      }
    )

    if (response.status === 404) {
      return null
    }
    if (!response.ok) {
      await throwApiError(response, "Failed to load the live demo")
    }
    return await response.json()
  } catch (error) {
    if (
      error instanceof DOMException &&
      error.name === "AbortError"
    ) {
      if (signal?.aborted && !timedOut) {
        throw error
      }
      throw new Error("Live demo request timed out.")
    }
    if (error instanceof TypeError) {
      throw new Error(
        "API service is unavailable. Check that the backend is running and reachable."
      )
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener("abort", abortRequest)
  }
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
    `organization:${userId.trim()}:${getActiveWorkspaceId(userId)}`

  return getCachedRead(
    cacheKey,
    async () => {
      const response =
        await fetchOrganizationRequest(
          `${API_URL}/organizations/me`,
          {
            headers: await workspaceHeaders(userId),
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

export async function updateAgencyOwnerWorkspaceAccess(
  enabled: boolean,
  userId: string
): Promise<OrganizationRecord> {
  const response =
    await fetchOrganizationRequest(
      `${API_URL}/organizations/agency-owner-access`,
      {
        method: "PATCH",
        headers: await workspaceJsonHeaders(userId),
        body: JSON.stringify({ enabled }),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Unable to update agency workspace access"
    )
  }

  invalidateApiReadCache([
    `organization:${userId.trim()}`,
    `organization-workspaces:${userId.trim()}`,
  ])

  return response.json()
}

export async function createOrganization(
  payload: string | OrganizationCreatePayload,
  userId: string,
  userEmail?: string
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
          userId,
          userEmail
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

export async function createClientWorkspace(
  payload: ClientWorkspaceCreatePayload,
  userId: string
): Promise<OrganizationWorkspaceRecord> {
  const response =
    await fetchOrganizationRequest(
      `${API_URL}/organizations/client-workspaces`,
      {
        method: "POST",
        headers: await workspaceJsonHeaders(userId),
        body: JSON.stringify(payload),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to create client workspace"
    )
  }

  invalidateApiReadCache([
    `organization-workspaces:${userId.trim()}`,
  ])

  return response.json()
}

export async function deleteClientWorkspace(
  organizationId: number,
  userId: string
) {
  const cleanOrganizationId = cleanPositiveIntegerId(
    organizationId,
    "Client workspace id"
  )
  const response = await fetchOrganizationRequest(
    `${API_URL}/organizations/client-workspaces/${cleanOrganizationId}`,
    {
      method: "DELETE",
      headers: await organizationOwnerHeaders(userId),
    }
  )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to delete client workspace"
    )
  }

  invalidateApiReadCache([
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
        headers: await workspaceJsonHeaders(userId),
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
  userId: string,
  workspaceId?: string
): Promise<OrganizationMemberRecord[]> {
  const response =
    await fetchOrganizationRequest(
      `${API_URL}/organizations/members`,
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
      "Failed to load organization members"
    )
  }

  return response.json()
}

export async function getOrganizationWorkspaces(
  userId: string,
  userEmail?: string,
  options?: {
    includeManagedClientWorkspaces?: boolean
  }
): Promise<OrganizationWorkspaceRecord[]> {
  const includeManagedClientWorkspaces =
    options?.includeManagedClientWorkspaces === true
  const cacheKey =
    `organization-workspaces:${userId.trim()}:${userEmail?.trim() || ""}:${includeManagedClientWorkspaces}`

  return getCachedRead(
    cacheKey,
    async () => {
      const response =
        await fetchOrganizationRequest(
          `${API_URL}/organizations/workspaces${
            includeManagedClientWorkspaces
              ? "?include_managed_client_workspaces=true"
              : ""
          }`,
          {
            headers: await organizationOwnerHeaders(
              userId,
              userEmail
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
  userId: string,
  workspaceId?: string
): Promise<OrganizationInviteRecord[]> {
  const response =
    await fetchOrganizationRequest(
      `${API_URL}/organizations/invites`,
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
      "Failed to load organization invites"
    )
  }

  return response.json()
}

export async function addOrganizationInvite(
  payload: OrganizationInviteCreatePayload,
  userId: string,
  workspaceId?: string
): Promise<OrganizationInviteRecord> {
  const response =
    await fetchOrganizationRequest(
      `${API_URL}/organizations/invites`,
      {
        method: "POST",
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
      "Failed to add organization invite"
    )
  }

  return response.json()
}

export async function addOrganizationMember(
  payload: OrganizationMemberCreatePayload,
  userId: string,
  workspaceId?: string
): Promise<OrganizationMemberRecord> {
  const response =
    await fetchOrganizationRequest(
      `${API_URL}/organizations/members`,
      {
        method: "POST",
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
  userId: string,
  workspaceId?: string
) {
  const response =
    await fetchOrganizationRequest(
      `${API_URL}/organizations/invites/${inviteId}`,
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
      "Failed to remove organization invite"
    )
  }

  return response.json()
}

export async function updateOrganizationMemberRole(
  memberId: number,
  role: string,
  userId: string,
  workspaceId?: string
): Promise<OrganizationMemberRecord> {
  const response =
    await fetchOrganizationRequest(
      `${API_URL}/organizations/members/${memberId}`,
      {
        method: "PATCH",
        headers: await workspaceJsonHeaders(
          userId,
          workspaceId
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
  userId: string,
  workspaceId?: string
) {
  const response =
    await fetchOrganizationRequest(
      `${API_URL}/organizations/members/${memberId}`,
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
  workspaceId?: string,
  options?: ForecastQueryOptions
): Promise<ForecastResponse> {
  const cleanDatasetId =
    cleanPositiveIntegerId(
      datasetId,
      "Dataset id"
    )
  const cleanMetric =
    metric?.trim() || ""
  const queryParams = new URLSearchParams()

  if (cleanMetric) {
    queryParams.set("metric", cleanMetric)
  }

  if (options?.startDate) {
    queryParams.set("start_date", options.startDate)
  }

  if (options?.periodFilter) {
    queryParams.set("period_filter", options.periodFilter)
  }

  if (options?.aggregation) {
    queryParams.set("aggregation", options.aggregation)
  }

  if (options?.aggregationType) {
    queryParams.set(
      "aggregation_type",
      options.aggregationType
    )
  }

  const query = queryParams.toString()
  const forecastQuery = query ? `?${query}` : ""
  const response =
    await apiFetch(
      `${API_URL}/forecasting/${cleanDatasetId}${forecastQuery}`,
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
  workspaceId?: string,
  dashboardDatasetIds?: Record<string, number>,
  dashboardViews?: Record<
    string,
    Record<string, DashboardPreferencePayload>
  >
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
    dashboard_dataset_ids?: Record<string, number>
    dashboard_views?: Record<
      string,
      Record<string, DashboardPreferencePayload>
    >
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

  if (dashboardDatasetIds !== undefined) {
    body.dashboard_dataset_ids =
      dashboardDatasetIds
  }

  if (dashboardViews !== undefined) {
    body.dashboard_views = dashboardViews
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
      `${API_URL}/decisions/${buildDecisionListQuery(
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

export async function exportDecisions(
  userId: string,
  workspaceId: string | undefined,
  format: "csv" | "json",
  options?: DecisionListOptions
): Promise<Blob> {
  const listQuery = buildDecisionListQuery(options)
  const separator = listQuery ? "&" : "?"
  const response =
    await apiFetch(
      `${API_URL}/decisions/export${listQuery}${separator}format=${format}`,
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
      "Failed to export decisions"
    )
  }

  return response.blob()
}

/* =========================
   Decision Portfolio Summary API For Metrics And Filter Counts
========================= */

export async function getDecisionSummary(
  userId: string,
  workspaceId?: string,
  datasetId?: number,
  mine = false
): Promise<DecisionSummary> {
  const cleanDatasetId =
    datasetId === undefined
      ? undefined
      : cleanPositiveIntegerId(
          datasetId,
          "Dataset id"
        )
  const params = new URLSearchParams()
  if (cleanDatasetId) {
    params.set(
      "dataset_id",
      String(cleanDatasetId)
    )
  }
  if (mine) {
    params.set(
      "mine",
      "true"
    )
  }
  const queryString = params.toString()
  const query = queryString
    ? `?${queryString}`
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

export async function getDecisionTemplates(
  userId: string,
  workspaceId?: string
): Promise<DecisionTemplate[]> {
  const response =
    await apiFetch(
      `${API_URL}/decisions/templates`,
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
      "Failed to load decision templates"
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

export async function deleteDecision(
  decisionId: number,
  userId: string,
  workspaceId?: string
): Promise<void> {
  const cleanDecisionId =
    cleanPositiveIntegerId(
      decisionId,
      "Decision id"
    )

  const response =
    await apiFetch(
      `${API_URL}/decisions/${cleanDecisionId}`,
      {
        method: "DELETE",
        headers: await decisionHeaders(
          userId,
          workspaceId
        ),
      }
    )

  if (!response.ok) {
    await throwApiError(
      response,
      "Failed to delete decision"
    )
  }
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

export async function getDecisionLifecycleAccess(
  decisionId: number,
  userId: string,
  workspaceId?: string
): Promise<DecisionLifecycleAccess> {
  const cleanDecisionId =
    cleanPositiveIntegerId(
      decisionId,
      "Decision id"
    )

  const response =
    await apiFetch(
      `${API_URL}/decisions/${cleanDecisionId}/lifecycle-access`,
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
      "Failed to load decision ownership"
    )
  }

  return response.json()
}

export async function getDecisionOutcomeAnalysis(
  decisionId: number,
  userId: string,
  workspaceId?: string,
  metricColumn?: string | null
): Promise<DecisionOutcomeAnalysisResponse> {
  const cleanDecisionId =
    cleanPositiveIntegerId(
      decisionId,
      "Decision id"
    )

  const query = new URLSearchParams()
  if (metricColumn !== undefined && metricColumn !== null) {
    query.set("metric_column", metricColumn)
  }
  const queryString = query.toString()

  const response =
    await apiFetch(
      `${API_URL}/decisions/${cleanDecisionId}/outcome-analysis${
        queryString ? `?${queryString}` : ""
      }`,
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

export async function submitSupportRequest(
  payload: SupportRequestPayload,
  userId: string,
  workspaceId?: string,
  userEmail?: string
): Promise<SupportRequestResponse> {
  const response = await apiFetch(
    `${API_URL}/support/requests`,
    {
      method: "POST",
      headers: await workspaceJsonHeaders(
        userId,
        workspaceId,
        userEmail
      ),
      body: JSON.stringify(payload),
    }
  )

  if (!response.ok) {
    await throwApiError(
      response,
      "Unable to send support request."
    )
  }

  return response.json()
}
