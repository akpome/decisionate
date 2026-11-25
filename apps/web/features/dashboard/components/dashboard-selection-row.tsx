"use client"

import { Check } from "lucide-react"
import { useDecisionateText } from "@/app/use-decisionate-language"

export function DashboardSelectionRow({ label, color, checked, disabled, onToggle }: {
  label: string
  color: string
  checked: boolean
  disabled?: boolean
  onToggle: () => void
}) {
  const { t } = useDecisionateText()
  const borderColor = `color-mix(in srgb, ${color} 40%, transparent)`
  return (
    <label className={`flex min-w-0 cursor-pointer items-center gap-3 rounded-xl border p-3 transition has-[:disabled]:cursor-not-allowed ${checked ? "" : "border-gray-100 bg-gray-50"}`}
      style={checked ? { borderColor, backgroundColor: `color-mix(in srgb, ${color} 7%, transparent)` } : undefined}>
      <input type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={onToggle} className="peer sr-only" />
      <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-disabled:opacity-50"
        style={checked ? { borderColor, color } : undefined}>
        {checked && <Check size={13} />}
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-sm font-semibold text-gray-900 [overflow-wrap:anywhere]">{label}</span>
        </span>
        <span className="block text-xs text-gray-500">{t(checked ? "Included in chart" : "Hidden from chart")}</span>
      </span>
    </label>
  )
}
