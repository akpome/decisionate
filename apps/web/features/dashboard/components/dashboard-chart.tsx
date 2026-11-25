"use client"

import { useEffect, useState, type ReactNode } from "react"
import { Maximize2, X } from "lucide-react"
import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts"

type ChartRow = Record<string, string | number | Date | null | undefined>
type ChartSeries = { dataKey: string; label: string; color: string }

export function indexDashboardChartRows(rows: ChartRow[], keys: string[], xKey: string) {
  const baselines = keys.map(key => rows.find(row => typeof row[key] === "number" && Number.isFinite(row[key]) && row[key] !== 0)?.[key])
  return rows.map(row => {
    const indexed: ChartRow = { [xKey]: row[xKey] }
    keys.forEach((key, i) => {
      const baseline = baselines[i]
      const value = row[key]
      const ratio = typeof value === "number" && typeof baseline === "number" ? value / baseline * 100 : NaN
      indexed[key] = Number.isFinite(ratio) ? ratio : null
    })
    return indexed
  })
}

export function DashboardTrendChart({
  rows, series, chartType, xKey, xLabel, margin = { top: 0, right: 32, left: 8, bottom: 42 }, yAxisWidth = 70,
  target = 0, extendTargetDomain = false, animate = true,
}: {
  rows: ChartRow[]
  series: ChartSeries[]
  chartType: "line" | "bar" | "area"
  xKey: string
  xLabel: string
  margin?: { top: number; right: number; left: number; bottom: number }
  yAxisWidth?: number
  target?: number
  extendTargetDomain?: boolean
  animate?: boolean
}) {
  return (
    <ComposedChart data={rows} margin={margin}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey={xKey} angle={-35} textAnchor="end" height={48} tickLine={false} tickMargin={8}
        label={{ value: xLabel, position: "insideBottom", offset: -28, style: { fill: "#6b7280", fontSize: 10 } }} />
      <YAxis width={yAxisWidth} tickLine={false} domain={chartType === "bar" ? [min => Math.min(0, min), max => Math.max(0, max)] : ["auto", "auto"]} />
      <Tooltip formatter={value => typeof value === "number" ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : value} />
      <Legend verticalAlign="top" wrapperStyle={{ overflowWrap: "anywhere", paddingRight: 34 }} />
      {target > 0 && <ReferenceLine y={target} ifOverflow={extendTargetDomain ? "extendDomain" : "discard"}
        stroke="var(--decisionate-brand-primary)" strokeDasharray="4 4"
        label={{ value: "Target", position: "insideTopRight", fill: "var(--decisionate-brand-primary)", fontSize: 12 }} />}
      {series.map(({ dataKey, label, color }, i) => {
        const props = { dataKey, name: label, isAnimationActive: animate }
        if (chartType === "bar") return <Bar key={dataKey} {...props} fill={color} radius={[8, 8, 0, 0]} />
        const hasIsolatedPoint = rows.some((row, j) =>
          typeof row[dataKey] === "number" && rows[j - 1]?.[dataKey] == null && rows[j + 1]?.[dataKey] == null)
        const curve = { ...props, type: "monotone" as const, stroke: color, dot: hasIsolatedPoint ? { r: 2 } : false, connectNulls: false }
        return chartType === "area"
          ? <Area key={dataKey} {...curve} fill={color} strokeWidth={i === 0 ? 4 : 3} fillOpacity={i === 0 ? 0.18 : 0.1} />
          : <Line key={dataKey} {...curve} strokeWidth={i === 0 ? 5 : 4} activeDot={{ r: 7 }} />
      })}
    </ComposedChart>
  )
}

export function FullscreenChartArea({
  title,
  ariaLabel,
  className,
  children,
}: {
  title: string
  ariaLabel: string
  className: string
  children: ReactNode
}) {
  const [isFullscreen, setIsFullscreen] =
    useState(false)

  useEffect(() => {
    if (!isFullscreen) {
      return
    }

    const previousOverflow =
      document.body.style.overflow
    document.body.style.overflow = "hidden"

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsFullscreen(false)
      }
    }

    window.addEventListener("keydown", handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [isFullscreen])

  return (
    <>
      <div className={`relative ${className}`}>
        {!isFullscreen && (
          <button
            type="button"
            onClick={() => setIsFullscreen(true)}
            title={`View ${title} full screen`}
            aria-label={`View ${title} full screen`}
            className="dashboard-print-hidden absolute right-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white/95 text-gray-500 shadow-sm transition hover:bg-white hover:text-gray-900"
          >
            <Maximize2 size={15} />
          </button>
        )}

        {!isFullscreen && <div className="absolute inset-0" role="img" aria-label={ariaLabel}>{children}</div>}
      </div>

      {isFullscreen && (
        <div
          className="dashboard-print-hidden fixed inset-0 z-[80] flex items-center justify-center bg-gray-950/60 p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={`${title} full screen chart`}
          onMouseDown={event => {
            if (event.target === event.currentTarget) {
              setIsFullscreen(false)
            }
          }}
        >
          <div className="flex h-full w-full max-w-[96rem] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200 px-4 py-3 sm:px-6 sm:py-4">
              <h2 className="truncate text-base font-semibold text-gray-950 sm:text-lg">
                {title}
              </h2>

              <button
                type="button"
                onClick={() => setIsFullscreen(false)}
                title="Close full screen chart"
                aria-label="Close full screen chart"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition hover:bg-gray-50 hover:text-gray-900"
              >
                <X size={18} />
              </button>
            </div>

            <div className="min-h-0 flex-1 p-4 sm:p-8">
              <div className="h-full min-h-0 w-full" role="img" aria-label={ariaLabel}>
                {children}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
