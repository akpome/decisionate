"use client"

import {
  type AnalyticsEngineStatus,
} from "@/lib/api"

interface AnalyticsEnginePanelProps {
  status: AnalyticsEngineStatus | null
}

export function AnalyticsEnginePanel({
  status,
}: AnalyticsEnginePanelProps) {
  if (!status) {
    return (
      <div className="rounded-xl border bg-white p-4 text-sm text-gray-500">
        Analytics engine status unavailable.
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <AnalyticsStatusItem
        label="Engine"
        value={formatStatusValue(
          status.engine
        )}
      />
      <AnalyticsStatusItem
        label="Storage"
        value={formatStatusValue(
          status.storage_format
        )}
        tone={
          status.portable_storage
            ? "good"
            : "neutral"
        }
      />
      <AnalyticsStatusItem
        label="BigQuery"
        value={
          status.bigquery_configured
            ? `Configured${
                status.bigquery_location
                  ? ` (${status.bigquery_location})`
                  : ""
              }`
            : "Not configured"
        }
      />
    </div>
  )
}

function AnalyticsStatusItem({
  label,
  value,
  tone = "neutral",
}: {
  label: string
  value: string
  tone?: "neutral" | "good"
}) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <p className="text-xs font-medium uppercase text-gray-500">
        {label}
      </p>

      <p
        className={
          tone === "good"
            ? "mt-2 font-semibold text-green-700"
            : "mt-2 font-semibold text-gray-800"
        }
      >
        {value}
      </p>
    </div>
  )
}

function formatStatusValue(
  value: string
) {
  return value
    .replace(/_/g, " ")
    .toUpperCase()
}
