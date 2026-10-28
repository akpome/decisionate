"use client"

import { useDecisionateText } from "@/app/use-decisionate-language"

export type ChartScale = "indexed" | "actual"

export function ChartScaleControl({ value, onChange }: { value: ChartScale; onChange: (value: ChartScale) => void }) {
  const { t } = useDecisionateText()
  return <div role="group" aria-label={t("Chart scale")} className="inline-flex shrink-0 gap-1 rounded-md border border-gray-200 p-1 print:hidden">
    {(["indexed", "actual"] as const).map(mode => <button type="button" key={mode} aria-pressed={value === mode} onClick={() => onChange(mode)} className={`min-h-10 min-w-20 rounded px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${value === mode ? "bg-blue-50 font-medium text-blue-800" : "text-gray-600 hover:bg-gray-50"}`}>{t(mode === "indexed" ? "Indexed" : "Actual")}</button>)}
  </div>
}
