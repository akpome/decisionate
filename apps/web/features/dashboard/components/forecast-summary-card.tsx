import {
  Activity,
  CalendarDays,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react"

interface ForecastSummaryCardProps {
  currentValue: number
  forecastValue: number
  metricName: string
  forecastPeriod?: string | null
  absoluteChange?: number
  percentChange?: number
}

export function ForecastSummaryCard({
  currentValue,
  forecastValue,
  metricName,
  forecastPeriod,
  absoluteChange,
  percentChange,
}: ForecastSummaryCardProps) {
  const change =
    absoluteChange ??
    forecastValue - currentValue
  const growth =
    percentChange ??
    (
      currentValue === 0
        ? 0
        : (
          (
            forecastValue
            - currentValue
          )
          / currentValue
        ) * 100
    )
  const isGrowing =
    growth > 5
  const isDeclining =
    growth < -5
  const trendLabel =
    isGrowing
      ? "Growing"
      : isDeclining
        ? "Declining"
        : "Stable"
  const TrendIcon =
    isDeclining
      ? TrendingDown
      : TrendingUp

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">
            Forecast Summary
          </h2>

          <p className="text-sm text-gray-500">
            Key forecast indicators.
          </p>
        </div>

        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
          Dataset-derived forecast
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] p-5">
          <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-white text-[var(--decisionate-brand-primary-text)] shadow-sm">
            <Target size={18} />
          </div>

          <p className="break-words text-3xl font-bold">
            {currentValue.toLocaleString()}
          </p>

          <p className="mt-2 text-sm font-medium text-gray-500">
            Current Value
          </p>

          <p className="mt-1 break-words text-xs text-gray-400">
            {metricName}
          </p>
        </div>

        <div className="rounded-xl border border-[var(--decisionate-brand-accent-ring)] bg-[var(--decisionate-brand-accent-soft)] p-5">
          <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-white text-[var(--decisionate-brand-accent-text)] shadow-sm">
            <CalendarDays size={18} />
          </div>

          <p className="break-words text-3xl font-bold">
            {forecastValue.toLocaleString()}
          </p>

          <p className="mt-2 text-sm font-medium text-gray-500">
            Forecast Value
          </p>

          <p className="mt-1 break-words text-xs text-gray-400">
            {forecastPeriod
              ? `Projected for ${forecastPeriod}`
              : "Projected horizon"}
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
          <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-white text-gray-700">
            <Activity size={18} />
          </div>

          <p className="break-words text-3xl font-bold">
            {growth > 0 ? "+" : ""}
            {growth.toFixed(1)}%
          </p>

          <p className="mt-2 text-sm font-medium text-gray-500">
            Change
          </p>

          <p className="mt-2 flex items-start gap-1.5 text-sm">
            <TrendIcon
              size={16}
              className="mt-0.5 shrink-0"
            />
            <span className="break-words">
              {trendLabel}
              {" "}
              ({change > 0 ? "+" : ""}
              {change.toLocaleString()})
            </span>
          </p>
        </div>
      </div>
    </div>
  )
}
