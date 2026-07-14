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
    data: Record<
        string,
        string | number | boolean | null | undefined
    >[]
}

export function ForecastChart({
    data,
}: ForecastChartProps) {
    if (!data.length) {
        return (
            <div className="flex h-[350px] items-center justify-center rounded-lg border bg-white">
                <p className="text-sm text-gray-500">
                    No forecast data available
                </p>
            </div>
        )
    }

    return (
        <div>
            <div className="mb-4 flex flex-wrap items-center gap-4 text-sm text-gray-600">
                <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-blue-600" />
                    Historical
                </div>

                <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
                    Forecast
                </div>
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
                            dataKey="historicalValue"
                            name="Historical"
                            stroke="#2563eb"
                            strokeWidth={3}
                            dot={true}
                            connectNulls={false}
                        />

                        <Line
                            type="monotone"
                            dataKey="forecastValue"
                            name="Forecast"
                            stroke="#059669"
                            strokeWidth={3}
                            strokeDasharray="6 4"
                            dot={true}
                            connectNulls={false}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    )
}
