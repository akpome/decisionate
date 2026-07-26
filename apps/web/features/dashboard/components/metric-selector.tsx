interface MetricSelectorProps {
  metrics: string[]
  value?: string
  onChange: (
    metric: string | undefined
  ) => void
  disabled?: boolean
  loadError?: boolean
  placeholder?: string
  ariaLabel?: string
}

export function MetricSelector({
  metrics,
  value,
  onChange,
  disabled = false,
  loadError = false,
  placeholder = "Select Metric",
  ariaLabel = "Select metric",
}: MetricSelectorProps) {
  const effectivePlaceholder = loadError
    ? "Metrics unavailable"
    : placeholder

  return (
    <select
      aria-label={ariaLabel}
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
          ? formatMetricLabel(value)
          : effectivePlaceholder
      }
      className="h-11 w-full min-w-0 truncate rounded-xl border px-3 py-2 pr-9 text-sm disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
    >
      <option value="">
        {effectivePlaceholder}
      </option>

      {metrics.map((metric) => (
        <option
          key={metric}
          value={metric}
        >
          {formatMetricLabel(metric)}
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
