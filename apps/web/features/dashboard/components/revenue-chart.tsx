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

interface RevenueChartProps {
  data: Record<string, any>[]
  xKey: string
  yKey: string
}

export function RevenueChart({
  data,
  xKey,
  yKey,
}: RevenueChartProps) {
  if (!data.length) {
    return (
      <div className="flex h-[350px] items-center justify-center rounded-2xl border bg-white">
        <p className="text-sm text-gray-500">
          No chart data available
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border bg-white p-6 shadow-sm">
      <div className="mb-6">
        <h2 className="text-xl font-semibold">
          Revenue Trend
        </h2>

        <p className="mt-1 text-sm text-gray-500">
          Automatically generated from uploaded dataset.
        </p>
      </div>

      <div className="h-[350px]">
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
              strokeWidth={3}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}