"use client"

import { Check } from "lucide-react"
import { useDecisionateText } from "@/app/use-decisionate-language"

export function DashboardSelectionRow({ label, color, checked, disabled, target, onToggle, onTargetChange }: {
  label: string
  color: string
  checked: boolean
  disabled?: boolean
  target?: number | null
  onToggle: () => void
  onTargetChange?: (value: number | null) => void
}) {
  const { t } = useDecisionateText()
  const colorTint = (opacity: number) => `color-mix(in srgb, ${color} ${opacity}%, transparent)`
  return (
    <div className="@container min-w-0">
      <div className={`flex h-full min-w-0 flex-col gap-3 rounded-xl border p-3 transition @min-[19rem]:flex-row @min-[19rem]:items-center @min-[19rem]:justify-between ${checked ? "" : "border-gray-100 bg-gray-50"}`}
        style={checked ? { borderColor: colorTint(40), backgroundColor: colorTint(7) } : undefined}>
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 has-[:disabled]:cursor-not-allowed">
          <input type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={onToggle} className="peer sr-only" />
          <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-disabled:opacity-50"
            style={checked ? { borderColor: colorTint(40), color } : undefined}>
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
        {onTargetChange && <label className="flex h-10 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs text-gray-500 focus-within:ring-2 focus-within:ring-blue-500 @min-[19rem]:w-36 @min-[19rem]:shrink-0 @min-[28rem]:w-52"
          style={checked ? { borderColor: colorTint(27) } : undefined}>
          <span className="shrink-0 font-medium">{t("Target")}</span>
          <input type="number" aria-label={`${t("Target")}: ${label}`} min={0} step="any"
            value={target && target > 0 ? target : ""} placeholder={t("Optional")}
            onChange={event => {
              const amount = event.target.valueAsNumber
              onTargetChange(Number.isFinite(amount) && amount > 0 ? amount : null)
            }} className="min-w-0 flex-1 bg-transparent text-sm text-gray-900 outline-none" />
        </label>}
      </div>
    </div>
  )
}
