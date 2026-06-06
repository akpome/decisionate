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

interface ForecastChartProps {
    data: Record<string, any>[]
}

export function ForecastChart({
    data,
}: ForecastChartProps) {
    if (!data.length) {
        return (
            <div className="flex h-[350px] items-center justify-center rounded-2xl border bg-white">
                <p className="text-sm text-gray-500">
                    No forecast data available
                </p>
            </div>
        )
    }

    return (
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <div className="mb-6">
                <h2 className="text-xl font-semibold">
                    Forecast Trend
                </h2>

                <p className="mt-1 text-sm text-gray-500">
                    Historical values and forecasted trend.
                </p>
            </div>

            <div className="h-[350px]">
                <ResponsiveContainer
                    width="100%"
                    height="100%"
                >
                    <LineChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" />

                        <XAxis dataKey="period" />

                        <YAxis />

                        <Tooltip />

                        <Line
                            type="monotone"
                            dataKey="value"
                            strokeWidth={3}
                            dot={true}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    )
}