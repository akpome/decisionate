interface MetricSelectorProps {
  metrics: string[]
  value?: string
  onChange: (
    metric: string
  ) => void
}

export function MetricSelector({
  metrics,
  value,
  onChange,
}: MetricSelectorProps) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) =>
        onChange(e.target.value)
      }
      className="rounded-lg border px-3 py-2"
    >
      <option value="">
        Select Metric
      </option>

      {metrics.map((metric) => (
        <option
          key={metric}
          value={metric}
        >
          {metric}
        </option>
      ))}
    </select>
  )
}