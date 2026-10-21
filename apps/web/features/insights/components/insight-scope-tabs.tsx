"use client"

import { ChartNoAxesCombined, Table2 } from "lucide-react"
import { useDecisionateText } from "@/app/use-decisionate-language"

export type InsightScope = "single" | "multi"

const tabs = [
  { scope: "single", label: "Single dataset insight", icon: Table2 },
  { scope: "multi", label: "Multi dataset insight", icon: ChartNoAxesCombined },
] as const

export function InsightScopeTabs({ scope, onChange }: { scope: InsightScope; onChange: (scope: InsightScope) => void }) {
  const { t } = useDecisionateText()
  return <div role="tablist" aria-label={t("Insight scope")} className="flex min-w-0 border-b border-gray-200">
    {tabs.map(({ scope: value, label, icon: Icon }) => <button key={value} type="button" role="tab" id={`insight-tab-${value}`} aria-controls={`insights-${value}`} aria-selected={scope === value} tabIndex={scope === value ? 0 : -1} onClick={() => onChange(value)} onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
      event.preventDefault()
      const next = event.key === "Home" ? "single" : event.key === "End" ? "multi" : value === "single" ? "multi" : "single"
      onChange(next)
      document.getElementById(`insight-tab-${next}`)?.focus()
    }} className={`inline-flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 border-b-2 px-2 py-2 text-center text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 sm:min-h-12 sm:flex-none sm:flex-row sm:gap-2 sm:px-4 sm:py-3 sm:text-sm ${scope === value ? "border-blue-600 bg-blue-50 text-blue-800" : "border-transparent text-gray-600 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-950"}`}><Icon size={17} aria-hidden="true" className="shrink-0" /><span className="min-w-0 break-words">{t(label)}</span></button>)}
  </div>
}
