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
