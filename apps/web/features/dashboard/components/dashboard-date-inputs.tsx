"use client"

import { changeDashboardDate, dashboardToday, type DashboardDateRange } from "@/features/dashboard/date-window"

export function DashboardDateInputs({ range, onChange, compact = false }: {
  range: DashboardDateRange
  onChange: (range: DashboardDateRange) => void
  compact?: boolean
}) {
  return <>{(["start", "end"] as const).map(field => <label key={field} className={compact
    ? "flex h-10 w-full min-w-0 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs sm:h-9 sm:w-auto sm:px-2"
    : "min-w-0 space-y-1 text-xs font-medium text-gray-500"}>
    <span className={compact ? "whitespace-nowrap font-medium text-gray-500" : "block"}>{field === "start" ? "Start date" : "End date"}</span>
    <input type="date" required value={range[field]} max={field === "start" ? range.end : dashboardToday()}
      min={field === "end" ? range.start : undefined}
      onChange={event => onChange(changeDashboardDate(range, field, event.target.value))}
      className={compact ? "h-7 min-w-0 flex-1 bg-transparent text-xs outline-none sm:flex-none"
        : "h-9 w-full min-w-0 rounded-md border border-gray-200 bg-white px-2 text-xs font-normal text-gray-700 outline-none focus:border-[var(--decisionate-brand-primary)] focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"} />
  </label>)}</>
}
