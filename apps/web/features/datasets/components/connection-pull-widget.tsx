"use client"

import Link from "next/link"
import { useState } from "react"

import type { DataSourceConnection } from "@/lib/api"

type ConnectionPullWidgetProps = {
  connections: DataSourceConnection[]
  loadError?: boolean
}

function formatStatus(
  status: DataSourceConnection["status"]
) {
  return status
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) =>
      letter.toUpperCase()
    )
}

function getStatusClasses(
  status: DataSourceConnection["status"]
) {
  if (status === "connected") {
    return "border-green-200 bg-green-50 text-green-700"
  }

  if (status === "error") {
    return "border-red-200 bg-red-50 text-red-700"
  }

  if (status === "needs_setup") {
    return "border-amber-200 bg-amber-50 text-amber-700"
  }

  return "border-gray-200 bg-gray-50 text-gray-600"
}

export function ConnectionPullWidget({
  connections,
  loadError = false,
}: ConnectionPullWidgetProps) {
  const [
    selectedConnectionId,
    setSelectedConnectionId,
  ] = useState("")

  const selectedConnection =
    connections.find(
      (connection) =>
        String(connection.id) ===
        selectedConnectionId
    ) ??
    connections[0] ??
    null

  const selectedId =
    selectedConnection?.id.toString() ?? ""
  const selectedConnectionLabel =
    selectedConnection
      ? `${selectedConnection.display_name} · ${selectedConnection.source_label}`
      : undefined
  const hasEnvironmentRequirement =
    selectedConnection?.environment_configured != null
  const isGoogleAnalyticsConnection =
    selectedConnection?.source_type ===
    "google_analytics"

  function handleSelectionChange(
    connectionId: string
  ) {
    setSelectedConnectionId(connectionId)
  }

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm sm:p-8">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">
            Saved Connection Status
          </h2>

          <p className="mt-2 text-sm text-gray-500">
            Review saved external connections and their dataset sync status.
          </p>
        </div>

        <Link
          href="/dashboard/connections"
          className="inline-flex w-full items-center justify-center rounded-lg border border-[var(--decisionate-brand-primary-ring)] px-3 py-2 text-sm font-medium text-[var(--decisionate-brand-primary-text)] hover:bg-[var(--decisionate-brand-primary-soft)] sm:w-auto sm:border-0 sm:px-0 sm:py-0 sm:hover:bg-transparent sm:hover:opacity-80"
        >
          Manage connections
        </Link>
      </div>

      {connections.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-gray-50 p-5 text-sm text-gray-600">
          {loadError
            ? "Saved connections are unavailable. Retry the data services above."
            : "No external connections have been added yet. Open Connections to add a provider, or upload a file from Datasets."}
        </div>
      ) : (
        <div className="space-y-5">
          <div>
            <label
              htmlFor="dataset-connection-source"
              className="mb-2 block text-sm font-medium text-gray-700"
            >
              Connection
            </label>

            <select
              id="dataset-connection-source"
              value={selectedId}
              title={selectedConnectionLabel}
              onChange={(event) =>
                handleSelectionChange(
                  event.target.value
                )
              }
              className="block w-full max-w-full truncate rounded-lg border border-gray-300 bg-white px-3 py-2 pr-9 text-sm focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
            >
              {connections.map((connection) => (
                <option
                  key={connection.id}
                  value={connection.id}
                >
                  {connection.display_name} · {connection.source_label}
                </option>
              ))}
            </select>
          </div>

          {selectedConnection && (
            <>
              <div className="grid min-w-0 gap-3 rounded-xl border bg-gray-50 p-4 text-sm sm:grid-cols-4">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-wide text-gray-400">
                    Source
                  </p>
                  <p className="mt-1 break-words font-medium text-gray-900">
                    {selectedConnection.source_label}
                  </p>
                </div>

                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-wide text-gray-400">
                    Status
                  </p>
                  <span
                    className={`mt-1 inline-flex max-w-full rounded-full border px-2.5 py-1 text-xs font-medium ${getStatusClasses(
                      selectedConnection.status
                    )}`}
                  >
                    {formatStatus(
                      selectedConnection.status
                    )}
                  </span>
                </div>

                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-wide text-gray-400">
                    Setup
                  </p>
                  <p className="mt-1 break-words font-medium text-gray-900">
                    {selectedConnection.has_config
                      ? "Configuration saved"
                      : "Needs configuration"}
                  </p>
                </div>

                {hasEnvironmentRequirement && (
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wide text-gray-400">
                      Credentials
                    </p>
                    <p
                      className={
                        selectedConnection.environment_configured
                          ? "mt-1 font-medium text-green-700"
                          : "mt-1 font-medium text-amber-700"
                      }
                    >
                      {selectedConnection.environment_configured
                        ? "Ready"
                        : "Needs setup"}
                    </p>
                  </div>
                )}
              </div>

              <div className="break-words rounded-lg border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] px-4 py-3 text-sm text-[var(--decisionate-brand-primary-text)]">
                {isGoogleAnalyticsConnection
                  ? "Configure the GA4 property and use Sync now from Manage connections to create a dataset."
                  : "Use Manage connections to finish setup or authorization, then sync the source to create a dataset."}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
