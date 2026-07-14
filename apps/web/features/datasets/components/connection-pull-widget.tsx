"use client"

import Link from "next/link"
import { useState } from "react"

import type { DataSourceConnection } from "@/lib/api"

type ConnectionPullWidgetProps = {
  connections: DataSourceConnection[]
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
}: ConnectionPullWidgetProps) {
  const [
    selectedConnectionId,
    setSelectedConnectionId,
  ] = useState("")
  const [
    preparedConnectionId,
    setPreparedConnectionId,
  ] = useState<number | null>(null)

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
  const hasEnvironmentRequirement =
    selectedConnection?.environment_configured != null
  const isReadyForPull =
    Boolean(
      selectedConnection?.has_config
    ) &&
    selectedConnection?.environment_configured !==
      false

  function handleSelectionChange(
    connectionId: string
  ) {
    setSelectedConnectionId(connectionId)
    setPreparedConnectionId(null)
  }

  function handlePreparePull() {
    if (!selectedConnection) {
      return
    }

    setPreparedConnectionId(
      selectedConnection.id
    )
  }

  return (
    <div className="rounded-2xl border bg-white p-8 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">
            Pull from Saved Connection
          </h2>

          <p className="mt-2 text-sm text-gray-500">
            Select an existing connection as the source for a dataset pull. Connection setup stays under Connections.
          </p>
        </div>

        <Link
          href="/dashboard/connections"
          className="text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          Manage connections
        </Link>
      </div>

      {connections.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-gray-50 p-5 text-sm text-gray-600">
          No saved connections yet. Create a PostgreSQL or external source connection first, then return here to use it as a dataset source.
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
              onChange={(event) =>
                handleSelectionChange(
                  event.target.value
                )
              }
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
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
              <div className="grid gap-3 rounded-xl border bg-gray-50 p-4 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-400">
                    Source
                  </p>
                  <p className="mt-1 font-medium text-gray-900">
                    {selectedConnection.source_label}
                  </p>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-400">
                    Status
                  </p>
                  <span
                    className={`mt-1 inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getStatusClasses(
                      selectedConnection.status
                    )}`}
                  >
                    {formatStatus(
                      selectedConnection.status
                    )}
                  </span>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-400">
                    Setup
                  </p>
                  <p className="mt-1 font-medium text-gray-900">
                    {selectedConnection.has_config
                      ? "Configuration saved"
                      : "Needs configuration"}
                  </p>
                </div>

                {hasEnvironmentRequirement && (
                  <div>
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
                        ? "Configured"
                        : "Not configured"}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={handlePreparePull}
                  className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800"
                >
                  Use for Dataset Pull
                </button>

                <p className="text-sm text-gray-500">
                  {isReadyForPull
                    ? "Ready to use this saved connection for dataset ingestion work."
                    : "Add the required connection settings and credentials before pulling data from this source."}
                </p>
              </div>

              {preparedConnectionId ===
                selectedConnection.id && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                  {selectedConnection.display_name} is selected as the dataset pull source. The pull job can use this saved connection without exposing engine details here.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
