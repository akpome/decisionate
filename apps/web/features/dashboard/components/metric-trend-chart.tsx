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
import { formatMetricLabel } from "./metric-selector"

interface MetricTrendChartProps {
  data: Record<
    string,
    string | number | boolean | null | undefined
  >[]
  xKey: string
  yKey: string
}

export function MetricTrendChart({
  data,
  xKey,
  yKey,
}: MetricTrendChartProps) {
  if (!data.length) {
    return (
      <div className="flex h-[350px] items-center justify-center rounded-2xl border border-dashed bg-white p-6 text-center">
        <p className="max-w-sm text-sm text-gray-500">
          No chartable trend is available for this dataset yet. Use data with a date or period column and at least one numeric metric.
        </p>
      </div>
    )
  }

  const chartDescription =
    getMetricTrendChartDescription(
      data,
      xKey,
      yKey
    )

  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="mb-6">
        <h2 className="text-xl font-semibold">
          {formatMetricLabel(yKey)} Trend
        </h2>

        <p className="mt-1 text-sm text-gray-500">
          Automatically generated from uploaded dataset.
        </p>
      </div>

      <div
        className="h-[350px]"
        role="img"
        aria-label={chartDescription}
      >
        <ResponsiveContainer
          width="100%"
          height="100%"
        >
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />

            <XAxis dataKey={xKey} />

            <YAxis />

            <Tooltip />

            <Line
              type="monotone"
              dataKey={yKey}
              name={formatMetricLabel(yKey)}
              stroke="var(--decisionate-brand-primary)"
              strokeWidth={3}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function getMetricTrendChartDescription(
  data: Record<
    string,
    string | number | boolean | null | undefined
  >[],
  xKey: string,
  yKey: string
) {
  if (!data.length) {
    return "No metric trend chart data is available."
  }

  const firstRow = data[0]
  const lastRow = data[data.length - 1]

  return `${formatMetricLabel(yKey)} trend chart across ${
    data.length
  } period${data.length === 1 ? "" : "s"} from ${formatMetricTrendValue(
    firstRow[xKey]
  )} to ${formatMetricTrendValue(
    lastRow[xKey]
  )}. Latest value is ${formatMetricTrendValue(lastRow[yKey])}.`
}

function formatMetricTrendValue(
  value: string | number | boolean | null | undefined
) {
  if (typeof value === "number") {
    return value.toLocaleString(
      undefined,
      {
        maximumFractionDigits: 2,
      }
    )
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
