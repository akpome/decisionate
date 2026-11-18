export function dashboardToday(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

export function dashboardCalendarDate(value: unknown): Date | null {
  const day = typeof value === "string" ? value.trim().match(/^\d{4}-\d{2}-\d{2}(?=$|T| )/)?.[0] : null
  if (day) {
    const date = new Date(`${day}T00:00:00`)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : null
}

export type DashboardDateRange = { start: string; end: string }

function validDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function dashboardDateRange(saved: { startDate?: unknown; endDate?: unknown; periodFilter?: unknown } = {}, now = new Date()): DashboardDateRange {
  const today = dashboardToday(now)
  const end = validDay(saved.endDate) && saved.endDate <= today ? saved.endDate : today
  if (validDay(saved.startDate) && saved.endDate === end && saved.startDate <= end) return { start: saved.startDate, end }
  // Preserve the exact inclusive window of an older saved period.
  if (!saved.startDate && typeof saved.periodFilter === "string" && ["1m", "1q", "6m", "1y", "2y", "3y"].includes(saved.periodFilter)) {
    return { start: dashboardDateWindow(end, saved.periodFilter, now).start!, end }
  }
  const date = new Date(`${end}T00:00:00Z`)
  const year = date.getUTCFullYear() - 1, month = date.getUTCMonth()
  const day = Math.min(date.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate())
  return { start: new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10), end }
}

export function changeDashboardDate(range: DashboardDateRange, field: "start" | "end", value: string, now = new Date()): DashboardDateRange {
  if (!validDay(value) || value > dashboardToday(now)) return range
  return field === "start"
    ? { start: value, end: value > range.end ? value : range.end }
    : { start: value < range.start ? value : range.start, end: value }
}

export function dashboardDateWindow(endDate: string, period: string, now = new Date()) {
  const end = /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate : dashboardToday(now)
  const months = { "1m": 1, "1q": 3, "6m": 6, "1y": 12, "2y": 24, "3y": 36, "5y": 60 }[period]
  if (!months) return { start: undefined, end }
  const date = new Date(`${end}T00:00:00Z`)
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, 1))
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  first.setUTCDate(Math.min(date.getUTCDate(), lastDay) + 1)
  return { start: first.toISOString().slice(0, 10), end }
}
