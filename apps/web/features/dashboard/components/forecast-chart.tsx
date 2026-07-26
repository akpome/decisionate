"use client"

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"

type ForecastChartRow = Record<
  string,
  string | number | boolean | null | undefined
>

interface ForecastChartProps {
  data: ForecastChartRow[]
}

type ForecastTooltipPayload = {
  color?: string
  dataKey?: string | number
  name?: string | number
  value?: string | number | null
}

type ForecastTooltipProps = {
  active?: boolean
  label?: string | number
  payload?: ForecastTooltipPayload[]
}

function formatChartNumber(
  value: unknown
) {
  const numericValue =
    typeof value === "number"
      ? value
      : Number(value)

  if (!Number.isFinite(numericValue)) {
    return "—"
  }

  return numericValue.toLocaleString(
    undefined,
    {
      maximumFractionDigits: 2,
    }
  )
}

function formatAxisNumber(
  value: string | number
) {
  const numericValue = Number(value)

  if (!Number.isFinite(numericValue)) {
    return String(value)
  }

  return numericValue.toLocaleString(
    undefined,
    {
      notation: "compact",
      maximumFractionDigits: 1,
    }
  )
}

function ForecastTooltip({
  active,
  label,
  payload,
}: ForecastTooltipProps) {
  const visiblePayload = (
    payload ?? []
  ).filter(
    (item) =>
      item.value !== null &&
      item.value !== undefined &&
      item.value !== ""
  )

  if (
    !active ||
    !visiblePayload.length
  ) {
    return null
  }

  return (
    <div className="rounded-xl border bg-white p-3 text-sm shadow-lg">
      <p className="mb-2 font-medium text-gray-900">
        {label}
      </p>

      <div className="space-y-1.5">
        {visiblePayload.map((item, index) => (
          <div
            key={`${item.dataKey ?? item.name ?? "series"}-${index}`}
            className="flex items-center justify-between gap-6"
          >
            <span className="flex items-center gap-2 text-gray-600">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{
                  backgroundColor:
                    item.color ||
                    "var(--decisionate-brand-primary)",
                }}
              />
              {item.name}
            </span>

            <span className="font-semibold text-gray-900">
              {formatChartNumber(
                item.value
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ForecastChart({
  data,
}: ForecastChartProps) {
  if (!data.length) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex h-[350px] items-center justify-center rounded-lg border bg-white"
      >
        <p className="text-sm text-gray-500">
          No forecast data available
        </p>
      </div>
    )
  }

  const chartDescription =
    getForecastChartDescription(data)

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-4 text-sm text-gray-600">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--decisionate-brand-primary)]" />
          Historical
        </div>

        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--decisionate-brand-accent)]" />
          Forecast
        </div>
      </div>

      <div
        className="h-[350px] min-w-0"
        role="img"
        aria-label={chartDescription}
      >
        <ResponsiveContainer
          width="100%"
          height="100%"
        >
          <LineChart
            data={data}
            margin={{
              top: 12,
              right: 18,
              left: 8,
              bottom: 12,
            }}
          >
            <CartesianGrid
              stroke="#e5e7eb"
              strokeDasharray="3 3"
              vertical={false}
            />

            <XAxis
              dataKey="period"
              axisLine={{
                stroke: "#e5e7eb",
              }}
              tick={{
                fill: "#6b7280",
                fontSize: 12,
              }}
              tickLine={false}
              tickMargin={10}
              minTickGap={24}
            />

            <YAxis
              axisLine={false}
              tick={{
                fill: "#6b7280",
                fontSize: 12,
              }}
              tickFormatter={
                formatAxisNumber
              }
              tickLine={false}
              width={64}
            />

            <Tooltip
              content={
                <ForecastTooltip />
              }
              cursor={{
                stroke: "#d1d5db",
                strokeDasharray: "4 4",
              }}
            />

            <Line
              type="monotone"
              dataKey="historicalValue"
              name="Historical"
              stroke="var(--decisionate-brand-primary)"
              strokeWidth={3}
              dot={{
                r: 3,
              }}
              activeDot={{
                r: 5,
              }}
              connectNulls={false}
            />

            <Line
              type="monotone"
              dataKey="forecastValue"
              name="Forecast"
              stroke="var(--decisionate-brand-accent)"
              strokeWidth={3}
              strokeDasharray="6 4"
              dot={{
                r: 3,
              }}
              activeDot={{
                r: 5,
              }}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function getForecastChartDescription(
  data: ForecastChartRow[]
) {
  const firstPeriod =
    formatForecastChartValue(data[0]?.period)
  const lastPeriod =
    formatForecastChartValue(
      data[data.length - 1]?.period
    )
  const latestHistoricalValue =
    getLatestSeriesValue(
      data,
      "historicalValue"
    )
  const latestForecastValue =
    getLatestSeriesValue(
      data,
      "forecastValue"
    )

  return `Forecast chart across ${data.length} period${
    data.length === 1 ? "" : "s"
  } from ${firstPeriod} to ${lastPeriod}. Latest historical value is ${formatForecastChartValue(
    latestHistoricalValue
  )}. Latest forecast value is ${formatForecastChartValue(
    latestForecastValue
  )}.`
}

function getLatestSeriesValue(
  data: ForecastChartRow[],
  key: string
) {
  for (
    let index = data.length - 1;
    index >= 0;
    index -= 1
  ) {
    const value = data[index]?.[key]

    if (
      value !== null &&
      value !== undefined &&
      value !== ""
    ) {
      return value
    }
  }

  return null
}

function formatForecastChartValue(
  value: ForecastChartRow[string]
) {
  if (typeof value === "number") {
    return formatChartNumber(value)
  }

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "unknown"
  }

  return String(value)
}
