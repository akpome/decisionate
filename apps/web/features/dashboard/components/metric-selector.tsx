
"use client"

import { useDecisionateText } from "@/app/use-decisionate-language"

interface MetricSelectorProps {
  metrics: string[]
  options?: {
    value: string
    label: string
  }[]
  value?: string
  onChange: (
    metric: string | undefined
  ) => void
  disabled?: boolean
  loadError?: boolean
  placeholder?: string
  ariaLabel?: string
}

function isIdentifierMetricColumn(
  column: string
) {
  const words = column
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^a-z0-9]+/i)

  return words.some(word =>
    word.toLowerCase() === "id" ||
    word.toLowerCase() === "key" ||
    word.toLowerCase() === "code" ||
    word.toLowerCase() === "number" ||
    word.toLowerCase() === "no" ||
    word.toLowerCase() === "version"
  )
}

export function MetricSelector({
  metrics,
  options,
  value,
  onChange,
  disabled = false,
  loadError = false,
  placeholder = "Select Metric",
  ariaLabel = "Select metric",
}: MetricSelectorProps) {
  const { t } = useDecisionateText()
  const visibleOptions = options
    ? options
    : metrics
        .filter(metric => !isIdentifierMetricColumn(metric))
        .map(metric => ({
          value: metric,
          label: formatMetricLabel(metric),
        }))
  const effectivePlaceholder = loadError
    ? t("Metrics unavailable")
    : t(placeholder)

  return (
    <select
      aria-label={t(ariaLabel)}
      value={value ?? ""}
      onChange={(e) =>
        onChange(
          e.target.value ||
            undefined
        )
      }
      disabled={disabled}
      title={
        value
          ? options?.find(option => option.value === value)?.label ??
            formatMetricLabel(value)
          : effectivePlaceholder
      }
      className="h-10 w-full min-w-0 truncate rounded-lg border border-gray-200 bg-white px-3 py-2 pr-9 text-sm text-gray-800 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
    >
      <option value="">
        {effectivePlaceholder}
      </option>

      {visibleOptions.map((option) => (
        <option
          key={option.value}
          value={option.value}
        >
          {option.label}
        </option>
      ))}
    </select>
  )
}

export function DashboardMetricTargetFields({ metrics, metric, metricLabel, placeholder, target, onMetricChange, onTargetChange }: {
  metrics: string[]
  metric: string
  metricLabel: string
  placeholder?: string
  target: number
  onMetricChange: (metric: string | undefined) => void
  onTargetChange?: (metric: string, target: number | null) => void
}) {
  const { t } = useDecisionateText()
  return (
    <div className="@container">
      <div className="grid min-w-0 gap-3 @min-[28rem]:grid-cols-[minmax(0,1fr)_13rem]">
        <label className="block min-w-0 space-y-1 text-xs font-medium text-gray-600">
          <span>{t(metricLabel)}</span>
          <MetricSelector metrics={metrics} value={metric} ariaLabel={metricLabel}
            placeholder={metrics.length ? placeholder : "No numeric metrics available"}
            disabled={!metrics.length} onChange={onMetricChange} />
        </label>
        <label className="block min-w-0 space-y-1 text-xs font-medium text-gray-600">
          <span>{t("Metric target")}</span>
          <input type="number" className="h-10 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 disabled:bg-gray-50 disabled:opacity-60 read-only:bg-gray-50"
            inputMode="decimal" min={0} step="any" disabled={!metric} readOnly={!onTargetChange}
            value={metric && target > 0 ? target : ""} placeholder={t("Optional")}
            onChange={event => {
              if (!metric) return
              const amount = event.target.valueAsNumber
              onTargetChange?.(metric, Number.isFinite(amount) && amount > 0 ? amount : null)
            }} />
        </label>
      </div>
    </div>
  )
}

export function formatMetricLabel(
  metric: string
) {
  if (!metric) return "None"

  return metric
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) =>
      letter.toUpperCase()
    )
}
