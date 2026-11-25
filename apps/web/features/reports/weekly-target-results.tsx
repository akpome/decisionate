import { useDecisionateText } from "@/app/use-decisionate-language"
import { formatReportValue, type WeeklyTargetAssessment } from "./types"

export function WeeklyTargetResults({ targets = [] }: { targets?: WeeklyTargetAssessment[] }) {
  const { t } = useDecisionateText()
  if (!targets.length) return null

  return <section aria-label={t("Weekly targets")} className="min-w-0 space-y-3 border-b border-gray-200 pb-5">
    <h3 className="text-lg font-semibold">{t("Weekly targets")}</h3>
    <ul className="divide-y divide-gray-100">
      {targets.map(target => {
        const amount = (value: number | null) => formatReportValue(value, target.currency)
        const rule = t(target.direction === "at_least" ? "At least" : "At most")
        const status = target.status === "met" ? "Target met" : target.status === "missed" ? "Target missed" : "Not enough data to assess"
        const gap = target.gap ?? 0
        const color = target.status === "met" ? "text-green-800" : target.status === "missed" ? "text-red-800" : "text-amber-900"
        const reason = target.reason === "metric_unavailable" ? t("Metric unavailable") : target.reason === "currency_unavailable" ? t("Currency not confirmed")
          : `${target.observed_days}/7 ${t("days with usable results")}`
        return <li key={target.metric_id} className="grid min-w-0 gap-2 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(9rem,auto)]">
          <div className="min-w-0 break-words"><p className="font-medium">{target.label}</p><p className="text-xs text-gray-600">{target.dataset_label}</p></div>
          <div className="min-w-0 break-words"><p>{rule} {amount(target.value)}</p>
            {target.actual !== null && <p className="text-xs text-gray-600">{t("Actual")}: {amount(target.actual)}</p>}</div>
          <div className="min-w-0 break-words sm:text-right"><p className={`font-semibold ${color}`}>{t(status)}</p>
            {target.status === "not_assessed" ? <p className="text-xs text-gray-600">{reason}</p>
              : gap !== 0 && <p className="text-xs text-gray-600">{amount(Math.abs(gap))} {t(gap > 0 ? "above target" : "below target")}</p>}</div>
        </li>
      })}
    </ul>
  </section>
}
