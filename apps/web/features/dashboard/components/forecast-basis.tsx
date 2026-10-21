import type { ForecastSeasonality } from "@/lib/api"

const statuses = {
  applied: "Seasonal patterns applied",
  not_requested: "Non-seasonal forecast",
  insufficient_history: "Insufficient seasonal history",
  not_supported: "Seasonal adjustment not supported by validation",
}

export function ForecastBasis({ basis }: { basis?: ForecastSeasonality }) {
  if (!basis) return null
  return (
    <section aria-label="Forecast basis" className="mt-4 min-w-0 border-t border-gray-200 pt-4 text-sm">
      <h3 className="font-semibold">{statuses[basis.status]}</h3>
      <p className="mt-1 break-words text-xs text-gray-500">
        Training: {basis.history_start} to {basis.history_end} / {basis.observations.toLocaleString()} observations / maximum {basis.lookback_years} years
      </p>
      {basis.seasonalities.length > 0 && (
        <p className="mt-1 text-xs text-gray-600">Calendar patterns: {basis.seasonalities.join(" + ")}</p>
      )}
      {basis.validation_method === "rolling_origin" && (
        <p className="mt-1 text-xs text-gray-500">Past-only validation / up to {basis.validation_horizon} periods ahead</p>
      )}
      {basis.warnings.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 break-words pl-5 text-xs text-amber-800 dark:text-amber-300">
          {basis.warnings.map(warning => <li key={warning}>{warning}</li>)}
        </ul>
      )}
    </section>
  )
}
