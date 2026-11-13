"use client"

const zones = ["UTC", ...Intl.supportedValuesOf("timeZone")]

export function completedWeek(zone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now)
  const part = (type: string) => Number(parts.find(item => item.type === type)?.value)
  const day = new Date(Date.UTC(part("year"), part("month") - 1, part("day")))
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7 - 1)
  const end = day.toISOString().slice(0, 10)
  day.setUTCDate(day.getUTCDate() - 6)
  return { start: day.toISOString().slice(0, 10), end }
}

export function WeeklyTimezone({ zone, onChange }: { zone: string; onChange: (zone: string) => void }) {
  const window = completedWeek(zone)
  return <div className="shrink-0 space-y-2 text-sm">
    <p className="font-medium">Last completed week</p><p>{window.start} to {window.end} / Monday-Sunday</p>
    <label className="block text-xs text-gray-600">Reporting timezone<select className="mt-1 min-h-10 w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-950" value={zone} onChange={event => onChange(event.target.value)}>
      {!zones.includes(zone) && <option value={zone}>{zone}</option>}{zones.map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
    </select></label>
  </div>
}
