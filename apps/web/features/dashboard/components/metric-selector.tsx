
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
    word.toLowerCase() === "code"
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
      className="h-11 w-full min-w-0 truncate rounded-xl border px-3 py-2 pr-9 text-sm disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
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
