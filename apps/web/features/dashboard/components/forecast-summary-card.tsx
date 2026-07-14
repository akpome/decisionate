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
      <div>
        <h2 className="text-xl font-semibold">
          Forecast Summary
        </h2>

        <p className="text-sm text-gray-500">
          Key forecast indicators.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border bg-white p-5 shadow-sm">
          <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
            <Target size={18} />
          </div>

          <p className="text-3xl font-bold">
            {currentValue.toLocaleString()}
          </p>

          <p className="mt-2 text-sm font-medium text-gray-500">
            Current Value
          </p>

          <p className="mt-1 text-xs text-gray-400">
            {metricName}
          </p>
        </div>

        <div className="rounded-lg border bg-white p-5 shadow-sm">
          <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
            <CalendarDays size={18} />
          </div>

          <p className="text-3xl font-bold">
            {forecastValue.toLocaleString()}
          </p>

          <p className="mt-2 text-sm font-medium text-gray-500">
            Forecast Value
          </p>

          <p className="mt-1 text-xs text-gray-400">
            {forecastPeriod
              ? `Projected for ${forecastPeriod}`
              : "Projected horizon"}
          </p>
        </div>

        <div className="rounded-lg border bg-white p-5 shadow-sm">
          <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100 text-gray-700">
            <Activity size={18} />
          </div>

          <p className="text-3xl font-bold">
            {growth > 0 ? "+" : ""}
            {growth.toFixed(1)}%
          </p>

          <p className="mt-2 text-sm font-medium text-gray-500">
            Change
          </p>

          <p className="mt-2 flex items-center gap-1.5 text-sm">
            <TrendIcon size={16} />
            <span>
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
