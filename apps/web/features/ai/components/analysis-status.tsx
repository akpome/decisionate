"use client"

import { useDecisionateText } from "@/app/use-decisionate-language"

type AnalysisStatusProps = {
  kind: "loading" | "unavailable"
  className?: string
  onRetry?: () => void
}

export function AnalysisStatus({
  kind,
  className = "",
  onRetry,
}: AnalysisStatusProps) {
  const isLoading = kind === "loading"
  const { t } = useDecisionateText()

  return (
    <div
      role={isLoading ? "status" : "alert"}
      aria-live="polite"
      className={`rounded-2xl border px-4 py-3 text-xs shadow-sm print:hidden ${
        isLoading
          ? "border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] text-[var(--decisionate-brand-primary-text)]"
          : "border-amber-200 bg-amber-50 text-amber-800"
      } ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          {isLoading
            ? t("Updating AI analysis for the selected metric...")
            : t("AI analysis is unavailable for the selected metric. The other dashboard data is still available.")}
        </span>

        {!isLoading && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-medium text-amber-800 transition hover:bg-amber-100"
          >
            {t("Retry AI analysis")}
          </button>
        )}
      </div>
    </div>
  )
}
