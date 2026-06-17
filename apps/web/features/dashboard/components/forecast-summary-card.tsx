interface ForecastSummaryCardProps {
  currentValue: number
  forecastValue: number
}

export function ForecastSummaryCard({
  currentValue,
  forecastValue,
}: ForecastSummaryCardProps) {
  const growth =
    currentValue === 0
      ? 0
      : (
        (
          forecastValue
          - currentValue
        )
        / currentValue
      ) * 100

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
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <p className="text-4xl font-bold">
            {currentValue.toFixed(0)}
          </p>

          <p className="mt-2 text-sm text-gray-500">
            Current Value
          </p>
        </div>

        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <p className="text-4xl font-bold">
            {forecastValue.toFixed(0)}
          </p>

          <p className="mt-2 text-sm text-gray-500">
            Forecast Value
          </p>
        </div>

        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <p className="text-4xl font-bold">
            {growth > 0 ? "+" : ""}
            {growth.toFixed(1)}%
          </p>

          <p className="mt-2 text-sm text-gray-500">
            Growth
          </p>

          <p className="mt-2 text-sm">
            {
              growth > 5
                ? "↑ Growing"
                : growth < -5
                  ? "↓ Declining"
                  : "→ Stable"
            }
          </p>
        </div>
      </div>
    </div>
  )
}