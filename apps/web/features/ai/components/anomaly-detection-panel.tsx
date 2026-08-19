import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  RefreshCw,
} from "lucide-react"

import {
  formatMetricLabel,
} from "@/features/dashboard/components/metric-selector"
import type {
  DatasetAnomaliesResponse,
  DatasetAnomalyMetric,
  DatasetAnomalyPoint,
} from "@/lib/api"

type AnomalySensitivity =
  | "high"
  | "medium"
  | "low"

type AnomalyDetectionPanelProps = {
  result: DatasetAnomaliesResponse | null
  loading: boolean
  error?: string
  sensitivity: AnomalySensitivity
  onSensitivityChange: (
    sensitivity: AnomalySensitivity
  ) => void
  onRetry?: () => void
  onCreateDecision?: (
    metric: string,
    anomaly: DatasetAnomalyPoint
  ) => void
  creatingDecisionKey?: string
}

function formatAnomalyNumber(value: number) {
  return new Intl.NumberFormat(
    "en-US",
    {
      maximumFractionDigits: 2,
    }
  ).format(value)
}

function formatAnomalyPeriod(period: string) {
  const datePart = period.slice(0, 10)
  const date = new Date(`${datePart}T00:00:00`)

  if (Number.isNaN(date.getTime())) {
    return period
  }

  return date.toLocaleDateString(
    "en-US",
    {
      month: "short",
      day: "numeric",
      year: "numeric",
    }
  )
}

function methodLabel(
  metric: DatasetAnomalyMetric
) {
  if (metric.method === "median_absolute_deviation") {
    return "Median/MAD baseline"
  }

  if (metric.method === "interquartile_range") {
    return "IQR baseline"
  }

  if (metric.method === "standard_deviation") {
    return "Standard-deviation baseline"
  }

  if (metric.method === "constant_series") {
    return "Constant-series baseline"
  }

  return "Not evaluated"
}

function anomalyKey(
  metric: string,
  anomaly: DatasetAnomalyPoint
) {
  return `${metric}:${anomaly.period}:${anomaly.direction}`
}

export function AnomalyDetectionPanel({
  result,
  loading,
  error,
  sensitivity,
  onSensitivityChange,
  onRetry,
  onCreateDecision,
  creatingDecisionKey,
}: AnomalyDetectionPanelProps) {
  const metrics = result?.metrics ?? []
  const totalAnomalies =
    result?.total_anomaly_count ?? 0

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <AlertTriangle
              size={19}
              className="text-amber-600"
            />
            <h2 className="text-lg font-semibold text-gray-900">
              Anomaly detection
            </h2>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            Statistical outliers in the selected dataset window. This identifies unusual values and does not infer their cause.
          </p>
        </div>

        <label className="flex shrink-0 items-center gap-2 text-xs font-medium text-gray-500">
          <span>Sensitivity</span>
          <select
            aria-label="Anomaly detection sensitivity"
            value={sensitivity}
            disabled={loading}
            onChange={event =>
              onSensitivityChange(
                event.target.value as AnomalySensitivity
              )
            }
            className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-xs font-normal text-gray-700 outline-none focus:border-[var(--decisionate-brand-primary)] focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)] disabled:cursor-not-allowed disabled:bg-gray-100"
          >
            <option value="high">High</option>
            <option value="medium">Balanced</option>
            <option value="low">Low</option>
          </select>
        </label>
      </div>

      {result?.method_description && (
        <p className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-600">
          {result.method_description}
        </p>
      )}

      {loading && (
        <div className="mt-5 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-600">
          <RefreshCw
            size={16}
            className="animate-spin"
          />
          Evaluating the selected time series...
        </div>
      )}

      {!loading && error && (
        <div className="mt-5 flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between">
          <span>{error}</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex w-fit items-center gap-2 rounded-md border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-700 transition hover:bg-red-100"
            >
              <RefreshCw size={14} />
              Retry
            </button>
          )}
        </div>
      )}

      {!loading && !error && result && (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Stat
              label="Detected anomalies"
              value={String(totalAnomalies)}
            />
            <Stat
              label="Metrics evaluated"
              value={String(metrics.length)}
            />
            <Stat
              label="Minimum periods"
              value={String(result.minimum_observations)}
            />
          </div>

          {result.data_notes.map(note => (
            <p
              key={note}
              className="mt-3 text-xs leading-5 text-amber-700"
            >
              {note}
            </p>
          ))}

          {result.status !== "ready" && (
            <div className="mt-5 rounded-lg border border-dashed border-gray-300 px-4 py-4 text-sm text-gray-600">
              {result.message || "Anomaly detection could not be evaluated for this selection."}
            </div>
          )}

          {result.status === "ready" && metrics.length === 0 && (
            <div className="mt-5 rounded-lg border border-dashed border-gray-300 px-4 py-4 text-sm text-gray-600">
              No numeric metrics are available for this dataset.
            </div>
          )}

          {result.status === "ready" && metrics.length > 0 && (
            <div className="mt-5 space-y-4">
              {metrics.map(metric => (
                <MetricAnomalyGroup
                  key={metric.metric}
                  metric={metric}
                  onCreateDecision={onCreateDecision}
                  creatingDecisionKey={creatingDecisionKey}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}

function Stat({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
      <p className="text-xs font-medium text-gray-500">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold text-gray-900">
        {value}
      </p>
    </div>
  )
}

function MetricAnomalyGroup({
  metric,
  onCreateDecision,
  creatingDecisionKey,
}: {
  metric: DatasetAnomalyMetric
  onCreateDecision?: (
    metric: string,
    anomaly: DatasetAnomalyPoint
  ) => void
  creatingDecisionKey?: string
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200">
      <div className="flex flex-col gap-2 bg-gray-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-medium text-gray-900">
            {formatMetricLabel(metric.metric)}
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            {metric.observation_count} periods • {methodLabel(metric)}
            {metric.threshold != null
              ? ` • threshold ${metric.threshold}`
              : ""}
          </p>
        </div>
        <span className="text-xs font-medium text-gray-600">
          {metric.anomaly_count} detected
        </span>
      </div>

      {metric.anomalies.length === 0 ? (
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-gray-600">
          <CheckCircle2
            size={16}
            className="text-green-600"
          />
          {metric.message || "No anomalies detected."}
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {metric.anomalies.map(anomaly => {
            const key = anomalyKey(
              metric.metric,
              anomaly
            )
            const isCreating =
              creatingDecisionKey === `anomaly:${key}`

            return (
              <div
                key={key}
                className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="flex min-w-0 items-start gap-3">
                  {anomaly.direction === "high" ? (
                    <ArrowUp
                      size={17}
                      className="mt-0.5 shrink-0 text-red-600"
                    />
                  ) : (
                    <ArrowDown
                      size={17}
                      className="mt-0.5 shrink-0 text-blue-600"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">
                      {formatAnomalyPeriod(anomaly.period)} · {anomaly.direction === "high" ? "High" : "Low"} value
                    </p>
                    <p className="mt-1 text-xs leading-5 text-gray-500">
                      Observed {formatAnomalyNumber(anomaly.value)} vs baseline {formatAnomalyNumber(anomaly.baseline)} · score {formatAnomalyNumber(Math.abs(anomaly.score))}
                    </p>
                  </div>
                </div>

                {onCreateDecision && (
                  <button
                    type="button"
                    disabled={Boolean(creatingDecisionKey)}
                    onClick={() =>
                      onCreateDecision(metric.metric, anomaly)
                    }
                    className="inline-flex w-fit items-center justify-center rounded-lg border border-[var(--decisionate-brand-primary-ring)] bg-white px-3 py-2 text-xs font-medium text-[var(--decisionate-brand-primary-text)] transition hover:bg-[var(--decisionate-brand-primary-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isCreating
                      ? "Creating decision..."
                      : "Create decision"}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
