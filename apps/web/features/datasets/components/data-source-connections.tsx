"use client"

import { useState } from "react"

import {
  type DataSourceConnection,
  type DataSourceConnectionStatus,
  type DataSourceConnectionSyncPayload,
  type DatasetSourceOption,
} from "@/lib/api"

interface DataSourceConnectionsProps {
  connections: DataSourceConnection[]
  loadError?: boolean
  sources?: DatasetSourceOption[]
  deletingConnectionId?: number | null
  updatingConnectionId?: number | null
  syncingConnectionId?: number | null
  onDeleteConnection?: (
    connection: DataSourceConnection
  ) => void
  onRenameConnection?: (
    connection: DataSourceConnection,
    displayName: string
  ) => void
  onConfigureConnection?: (
    connection: DataSourceConnection,
    connectionConfig: Record<string, unknown>
  ) => void
  onSyncConnection?: (
    connection: DataSourceConnection,
    payload: DataSourceConnectionSyncPayload
  ) => void
  onStartOAuthConnection?: (
    connection: DataSourceConnection
  ) => void
  onUpdateSchedule?: (
    connection: DataSourceConnection,
    enabled: boolean,
    intervalHours: number,
    timeOfDay: string,
    timezone: string
  ) => void
}

function getBrowserTimezone() {
  if (typeof Intl === "undefined") {
    return "UTC"
  }

  return (
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC"
  )
}

export function DataSourceConnections({
  connections,
  loadError = false,
  sources = [],
  deletingConnectionId,
  updatingConnectionId,
  syncingConnectionId,
  onDeleteConnection,
  onRenameConnection,
  onConfigureConnection,
  onSyncConnection,
  onStartOAuthConnection,
  onUpdateSchedule,
}: DataSourceConnectionsProps) {
  const [
    editingConnectionId,
    setEditingConnectionId,
  ] = useState<number | null>(null)
  const [
    editingDisplayName,
    setEditingDisplayName,
  ] = useState("")
  const [
    configuringConnectionId,
    setConfiguringConnectionId,
  ] = useState<number | null>(null)
  const [
    editingConnectionConfig,
    setEditingConnectionConfig,
  ] = useState<Record<string, string>>({})

  function startEditing(
    connection: DataSourceConnection
  ) {
    setEditingConnectionId(
      connection.id
    )
    setEditingDisplayName(
      connection.display_name
    )
  }

  function stopEditing() {
    setEditingConnectionId(null)
    setEditingDisplayName("")
  }

  function startConfiguring(
    connection: DataSourceConnection
  ) {
    const source =
      getConnectionSource(
        connection,
        sources
    )
    const emptyConfig =
      Object.fromEntries(
        getEditableConnectionConfigKeys(
          source
        ).map((key) => [key, ""])
      )

    setConfiguringConnectionId(
      connection.id
    )
    setEditingConnectionConfig(
      emptyConfig
    )
  }

  function stopConfiguring() {
    setConfiguringConnectionId(null)
    setEditingConnectionConfig({})
  }

  function saveEditing(
    connection: DataSourceConnection
  ) {
    const nextDisplayName =
      editingDisplayName.trim()

    if (
      !nextDisplayName ||
      nextDisplayName === connection.display_name
    ) {
      return
    }

    onRenameConnection?.(
      connection,
      nextDisplayName
    )
    stopEditing()
  }

  function saveConfiguration(
    connection: DataSourceConnection
  ) {
    const source =
      getConnectionSource(
        connection,
        sources
      )
    const configKeys =
      getEditableConnectionConfigKeys(
        source
      )
    const connectionConfig =
      Object.fromEntries(
        configKeys
          .map((key) => [
            key,
            editingConnectionConfig[key]?.trim() ?? "",
          ])
          .filter(([, value]) => Boolean(value))
      )

    if (!Object.keys(connectionConfig).length) {
      return
    }

    onConfigureConnection?.(
      connection,
      connectionConfig
    )
    stopConfiguring()
  }

  function clearConfiguration(
    connection: DataSourceConnection
  ) {
    onConfigureConnection?.(
      connection,
      {}
    )
    stopConfiguring()
  }

  function confirmDeleteConnection(
    connection: DataSourceConnection
  ) {
    const confirmed =
      window.confirm(
        `Remove ${connection.display_name}? This connection will be removed from Configure Added Connections. Dataset files already uploaded will remain, but this source will need to be added and configured again before future pulls.`
      )

    if (!confirmed) {
      return
    }

    onDeleteConnection?.(connection)
  }

  if (!connections.length) {
    return (
      <div className="rounded-xl border bg-white p-4 text-sm text-gray-500">
        {loadError
          ? "Saved data source connections are unavailable. Retry the data services above."
          : "No external data source connections have been added yet. Add one from the available connections above."}
      </div>
    )
  }

  return (
    <div className="divide-y rounded-xl border">
      {connections.map((connection) => (
        <DataSourceConnectionRow
          key={connection.id}
          connection={connection}
          deletingConnectionId={
            deletingConnectionId
          }
          updatingConnectionId={
            updatingConnectionId
          }
          syncingConnectionId={
            syncingConnectionId
          }
          editingConnectionId={
            editingConnectionId
          }
          editingDisplayName={
            editingDisplayName
          }
          setEditingDisplayName={
            setEditingDisplayName
          }
          startEditing={startEditing}
          stopEditing={stopEditing}
          saveEditing={saveEditing}
          onDeleteConnection={
            confirmDeleteConnection
          }
          onRenameConnection={
            onRenameConnection
          }
          onConfigureConnection={
            onConfigureConnection
          }
          onSyncConnection={
            onSyncConnection
          }
          onStartOAuthConnection={
            onStartOAuthConnection
          }
          onUpdateSchedule={onUpdateSchedule}
          sources={sources}
          configuringConnectionId={
            configuringConnectionId
          }
          editingConnectionConfig={
            editingConnectionConfig
          }
          setEditingConnectionConfig={
            setEditingConnectionConfig
          }
          startConfiguring={startConfiguring}
          stopConfiguring={stopConfiguring}
          saveConfiguration={saveConfiguration}
          clearConfiguration={
            clearConfiguration
          }
        />
      ))}
    </div>
  )
}

function DataSourceConnectionRow({
  connection,
  deletingConnectionId,
  updatingConnectionId,
  syncingConnectionId,
  editingConnectionId,
  editingDisplayName,
  setEditingDisplayName,
  startEditing,
  stopEditing,
  saveEditing,
  onDeleteConnection,
  onRenameConnection,
  onConfigureConnection,
  onSyncConnection,
  onStartOAuthConnection,
  onUpdateSchedule,
  sources,
  configuringConnectionId,
  editingConnectionConfig,
  setEditingConnectionConfig,
  startConfiguring,
  stopConfiguring,
  saveConfiguration,
  clearConfiguration,
}: {
  connection: DataSourceConnection
  deletingConnectionId?: number | null
  updatingConnectionId?: number | null
  syncingConnectionId?: number | null
  editingConnectionId: number | null
  editingDisplayName: string
  setEditingDisplayName: (
    value: string
  ) => void
  startEditing: (
    connection: DataSourceConnection
  ) => void
  stopEditing: () => void
  saveEditing: (
    connection: DataSourceConnection
  ) => void
  onDeleteConnection?: (
    connection: DataSourceConnection
  ) => void
  onRenameConnection?: (
    connection: DataSourceConnection,
    displayName: string
  ) => void
  onConfigureConnection?: (
    connection: DataSourceConnection,
    connectionConfig: Record<string, unknown>
  ) => void
  onSyncConnection?: (
    connection: DataSourceConnection,
    payload: DataSourceConnectionSyncPayload
  ) => void
  onStartOAuthConnection?: (
    connection: DataSourceConnection
  ) => void
  onUpdateSchedule?: (
    connection: DataSourceConnection,
    enabled: boolean,
    intervalHours: number,
    timeOfDay: string,
    timezone: string
  ) => void
  sources: DatasetSourceOption[]
  configuringConnectionId: number | null
  editingConnectionConfig: Record<string, string>
  setEditingConnectionConfig: (
    value: Record<string, string>
  ) => void
  startConfiguring: (
    connection: DataSourceConnection
  ) => void
  stopConfiguring: () => void
  saveConfiguration: (
    connection: DataSourceConnection
  ) => void
  clearConfiguration: (
    connection: DataSourceConnection
  ) => void
}) {
  const isEditing =
    editingConnectionId === connection.id
  const isConfiguring =
    configuringConnectionId === connection.id
  const [syncStartDate, setSyncStartDate] =
    useState("")
  const [syncEndDate, setSyncEndDate] =
    useState("")
  const [syncMetrics, setSyncMetrics] =
    useState([
      "activeUsers",
      "sessions",
      "totalRevenue",
    ])
  const source =
    getConnectionSource(
      connection,
      sources
    )
  const configKeys =
    source?.config_keys ?? []
  const credentialKeys =
    getSourceCredentialKeys(source)
  const editableConfigKeys =
    getEditableConnectionConfigKeys(
      source
    )
  const requiresEnvironmentCredentials =
    credentialKeys.length > 0
  const environmentConfigured =
    connection.environment_configured ??
    source?.environment_configured
  const externalCredentialLabel =
    getExternalCredentialLabel(source)
  const connectionConfigHelpText =
    getConnectionConfigHelpText(source)
  const sourceIsPlanned =
    source?.status === "planned"
  const canConfigure =
    Boolean(
      onConfigureConnection &&
        editableConfigKeys.length > 0 &&
        !sourceIsPlanned
    )
  const canSyncConnector =
    [
      "google_analytics",
      "hubspot",
      "stripe",
      "shopify",
      "meta_ads",
      "quickbooks",
      "freshbooks",
      "sage",
      "xero",
      "salesforce",
      "netsuite",
      "postgresql",
      "mysql",
      "sql_server",
    ].includes(
      connection.source_type
    ) &&
    source?.status === "available" &&
    Boolean(onSyncConnection)
  const canStartOAuth =
    connection.source_type !== "google_analytics" &&
    source?.connection_type === "oauth" &&
    source.status === "available" &&
    Boolean(onStartOAuthConnection)
  const canSchedule =
    source?.sync_modes?.includes("scheduled") === true &&
    Boolean(onUpdateSchedule) &&
    !sourceIsPlanned
  const [scheduleEnabled, setScheduleEnabled] =
    useState(Boolean(connection.sync_enabled))
  const [scheduleIntervalHours, setScheduleIntervalHours] =
    useState(String(connection.sync_interval_hours ?? 24))
  const [scheduleTimeOfDay, setScheduleTimeOfDay] =
    useState(connection.sync_time_of_day ?? "09:00")
  const [scheduleTimezone] =
    useState(connection.sync_timezone ?? "")


  function toggleSyncMetric(metric: string) {
    setSyncMetrics((currentMetrics) =>
      currentMetrics.includes(metric)
        ? currentMetrics.filter(
            (currentMetric) =>
              currentMetric !== metric
          )
        : [
            ...currentMetrics,
            metric,
          ]
    )
  }

  function syncConnection() {
    onSyncConnection?.(
      connection,
      {
        ...(syncStartDate
          ? { start_date: syncStartDate }
          : {}),
        ...(syncEndDate
          ? { end_date: syncEndDate }
          : {}),
        dimensions: ["date"],
        metrics: syncMetrics,
      }
    )
  }
  const trimmedDisplayName =
    editingDisplayName.trim()
  const canSave =
    Boolean(trimmedDisplayName) &&
    trimmedDisplayName !==
      connection.display_name
  const hasEditedConfig =
    editableConfigKeys.some((configKey) =>
      Boolean(
        editingConnectionConfig[
          configKey
        ]?.trim()
      )
    )

  return (
    <div className="flex flex-col gap-4 bg-white p-4 first:rounded-t-xl last:rounded-b-xl md:flex-row md:items-start md:justify-between">
      <div className="min-w-0 flex-1">
        {isEditing ? (
          <div className="flex w-full max-w-md flex-col gap-2 sm:flex-row sm:flex-wrap">
            <input
              aria-label="Connection display name"
              value={editingDisplayName}
              onChange={(event) =>
                setEditingDisplayName(
                  event.target.value
                )
              }
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  canSave
                ) {
                  saveEditing(
                    connection
                  )
                }

                if (event.key === "Escape") {
                  stopEditing()
                }
              }}
              className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
            />

            <button
              type="button"
              onClick={() =>
                saveEditing(
                  connection
                )
              }
              disabled={
                updatingConnectionId ===
                  connection.id ||
                !canSave
              }
              className="w-full rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              Save
            </button>

            <button
              type="button"
              onClick={stopEditing}
              className="w-full rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 sm:w-auto"
            >
              Cancel
            </button>
          </div>
        ) : (
          <h3 className="break-words font-medium">
            {connection.display_name}
          </h3>
        )}

        <p className="mt-1 break-words text-sm text-gray-500">
          {connection.source_label}
        </p>

        {connection.availability_note && (
          <p className="mt-1 break-words text-xs text-amber-700">
            {connection.availability_note}
          </p>
        )}

        <p className="mt-2 text-xs font-medium uppercase text-gray-400">
          {connection.has_config
            ? "Config saved"
            : "No config saved"}
        </p>

        <p className="mt-1 text-xs text-gray-500">
          Last sync: {formatLastSyncedAt(
            connection.last_synced_at
          )}
        </p>

        {requiresEnvironmentCredentials && (
          <p
            className={
              environmentConfigured
                ? "mt-1 break-words text-xs text-green-700"
                : "mt-1 break-words text-xs text-amber-700"
            }
          >
            {externalCredentialLabel}:{" "}
            {environmentConfigured
              ? "ready"
              : "needs setup"}
          </p>
        )}

        {isConfiguring && (
          <div className="mt-4 max-w-2xl rounded-xl border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--decisionate-brand-primary-text)]">
              Configure connection settings
            </p>

            {configKeys.length > 0 && (
              <ConnectionConfigFieldGroup
                title="Dataset Settings"
                configKeys={configKeys}
                sourceType={connection.source_type}
                editingConnectionConfig={
                  editingConnectionConfig
                }
                hasSavedConfig={
                  connection.has_config
                }
                setEditingConnectionConfig={
                  setEditingConnectionConfig
                }
              />
            )}

            {credentialKeys.length > 0 && (
              <ConnectionConfigFieldGroup
                title={externalCredentialLabel}
                configKeys={credentialKeys}
                editingConnectionConfig={
                  editingConnectionConfig
                }
                hasSavedConfig={
                  connection.has_config
                }
                setEditingConnectionConfig={
                  setEditingConnectionConfig
                }
                secret
              />
            )}

            <p className="mt-2 text-xs text-[var(--decisionate-brand-primary-text)]">
              Saved values are hidden. Enter replacement values for the fields you want to save.
            </p>

            {requiresEnvironmentCredentials && (
              <p className="mt-1 text-xs text-[var(--decisionate-brand-primary-text)]">
                {connectionConfigHelpText}
              </p>
            )}

            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                onClick={() =>
                  saveConfiguration(
                    connection
                  )
                }
                disabled={
                  updatingConnectionId ===
                    connection.id ||
                  !hasEditedConfig
                }
                className="w-full rounded-lg border border-[var(--decisionate-brand-primary-ring)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--decisionate-brand-primary-text)] hover:bg-[var(--decisionate-brand-primary-soft)] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                {updatingConnectionId ===
                connection.id
                  ? "Saving..."
                  : "Save Replacement"}
              </button>

              {connection.has_config && (
                <button
                  type="button"
                  onClick={() =>
                    clearConfiguration(
                      connection
                    )
                  }
                  disabled={
                    updatingConnectionId ===
                    connection.id
                  }
                  className="w-full rounded-lg border border-red-100 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  Clear Saved Config
                </button>
              )}

              <button
                type="button"
                onClick={stopConfiguring}
                className="w-full rounded-lg border border-[var(--decisionate-brand-primary-ring)] bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 sm:w-auto"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {connection.source_type === "google_analytics" &&
          canSyncConnector && (
          <div className="mt-4 rounded-xl border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--decisionate-brand-primary-text)]">
              Google Analytics sync range and metrics
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-gray-600">
                Start date
                <input
                  type="date"
                  value={syncStartDate}
                  onChange={(event) =>
                    setSyncStartDate(
                      event.target.value
                    )
                  }
                  className="mt-1 block h-9 w-full rounded-lg border border-gray-300 bg-white px-2 text-sm text-gray-700"
                />
              </label>

              <label className="text-xs font-medium text-gray-600">
                End date
                <input
                  type="date"
                  value={syncEndDate}
                  onChange={(event) =>
                    setSyncEndDate(
                      event.target.value
                    )
                  }
                  className="mt-1 block h-9 w-full rounded-lg border border-gray-300 bg-white px-2 text-sm text-gray-700"
                />
              </label>
            </div>

            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
              {[
                "activeUsers",
                "sessions",
                "totalRevenue",
                "screenPageViews",
                "conversions",
              ].map((metric) => (
                <label
                  key={metric}
                  className="inline-flex items-center gap-2 text-xs text-gray-700"
                >
                  <input
                    type="checkbox"
                    checked={syncMetrics.includes(metric)}
                    onChange={() =>
                      toggleSyncMetric(metric)
                    }
                    className="h-4 w-4 rounded border-gray-300 text-[var(--decisionate-brand-primary)] focus:ring-[var(--decisionate-brand-primary-ring)]"
                  />
                  {metric}
                </label>
              ))}
            </div>

            <p className="mt-2 text-xs text-[var(--decisionate-brand-primary-text)]">
              Leave dates blank to sync the previous 365 days. Select at least one metric.
            </p>
          </div>
        )}

        {canSchedule && (
          <div className="mt-4 rounded-xl border bg-gray-50 p-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex h-9 items-center gap-2 text-xs font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={scheduleEnabled}
                  onChange={(event) =>
                    setScheduleEnabled(event.target.checked)
                  }
                  className="h-4 w-4 rounded border-gray-300 text-[var(--decisionate-brand-primary)] focus:ring-[var(--decisionate-brand-primary-ring)]"
                />
                Enable automatic sync
              </label>

              <label className="inline-flex h-9 items-center gap-2 text-xs font-medium text-gray-600">
                Every
                <select
                  value={scheduleIntervalHours}
                  onChange={(event) =>
                    setScheduleIntervalHours(event.target.value)
                  }
                  className="h-9 rounded-lg border border-gray-300 bg-white px-2 text-sm text-gray-700"
                >
                  {[1, 6, 12, 24, 72, 168].map((hours) => (
                    <option key={hours} value={hours}>
                      {hours < 24 ? `${hours} hours` : `${hours / 24} days`}
                    </option>
                  ))}
                </select>
              </label>

              <label className="inline-flex h-9 items-center gap-2 text-xs font-medium text-gray-600">
                At local time
                <input
                  type="time"
                  value={scheduleTimeOfDay}
                  onChange={(event) =>
                    setScheduleTimeOfDay(event.target.value)
                  }
                  className="h-9 rounded-lg border border-gray-300 bg-white px-2 text-sm text-gray-700"
                />
              </label>

              <button
                type="button"
                onClick={() =>
                  onUpdateSchedule?.(
                    connection,
                    scheduleEnabled,
                    Number(scheduleIntervalHours),
                    scheduleTimeOfDay,
                    scheduleTimezone || getBrowserTimezone()
                  )
                }
                disabled={updatingConnectionId === connection.id}
                className="h-9 rounded-lg border px-3 text-xs font-medium text-gray-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {updatingConnectionId === connection.id
                  ? "Saving..."
                  : "Save schedule"}
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Syncs follow this local time in {scheduleTimezone || "your local timezone"}.
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Connector data is kept raw for 24 months, then summarized for permanent historical analysis.
            </p>
          </div>
        )}
      </div>

      <div className="flex w-full shrink-0 flex-col items-start gap-2 md:w-auto md:items-end">
        <span
          className={getConnectionStatusClassName(
            connection.status
          )}
        >
          {formatConnectionStatus(
            connection.status
          )}
        </span>

        {!isEditing &&
          (onRenameConnection ||
            onDeleteConnection ||
            canConfigure ||
            canSyncConnector ||
            canStartOAuth) && (
            <div className="flex w-full flex-col gap-2 sm:flex-row md:w-auto">
              {canSyncConnector && (
                <button
                  type="button"
                  onClick={() =>
                    syncConnection()
                  }
                  disabled={
                    syncingConnectionId ===
                      connection.id ||
                    updatingConnectionId ===
                      connection.id ||
                    syncMetrics.length === 0
                  }
                  className="w-full rounded-lg border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] px-3 py-1.5 text-xs font-medium text-[var(--decisionate-brand-primary-text)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {syncingConnectionId ===
                  connection.id
                    ? "Syncing..."
                    : "Sync now"}
                </button>
              )}

              {canStartOAuth && (
                <button
                  type="button"
                  onClick={() =>
                    onStartOAuthConnection?.(connection)
                  }
                  disabled={
                    updatingConnectionId === connection.id
                  }
                  className="w-full rounded-lg border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] px-3 py-1.5 text-xs font-medium text-[var(--decisionate-brand-primary-text)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  Connect with OAuth
                </button>
              )}

              {canConfigure && (
                <button
                  type="button"
                  onClick={() =>
                    isConfiguring
                      ? stopConfiguring()
                      : startConfiguring(
                          connection
                        )
                  }
                  disabled={
                    updatingConnectionId ===
                    connection.id
                  }
                  className="w-full rounded-lg border px-3 py-1.5 text-xs font-medium text-[var(--decisionate-brand-primary-text)] hover:bg-[var(--decisionate-brand-primary-soft)] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {isConfiguring
                    ? "Close"
                    : "Configure"}
                </button>
              )}

              {onRenameConnection && (
                <button
                  type="button"
                  onClick={() =>
                    startEditing(
                      connection
                    )
                  }
                  disabled={
                    updatingConnectionId ===
                    connection.id
                  }
                  className="w-full rounded-lg border px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {updatingConnectionId ===
                  connection.id
                    ? "Saving..."
                    : "Rename"}
                </button>
              )}

              {onDeleteConnection && (
                <button
                  type="button"
                  onClick={() =>
                    onDeleteConnection(
                      connection
                    )
                  }
                  disabled={
                    deletingConnectionId ===
                    connection.id
                  }
                  className="w-full rounded-lg border px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {deletingConnectionId ===
                  connection.id
                    ? "Removing..."
                    : "Remove"}
                </button>
              )}
            </div>
          )}
      </div>
    </div>
  )
}

function ConnectionConfigFieldGroup({
  title,
  configKeys,
  sourceType,
  editingConnectionConfig,
  hasSavedConfig,
  setEditingConnectionConfig,
  secret = false,
}: {
  title: string
  configKeys: string[]
  sourceType?: string
  editingConnectionConfig: Record<string, string>
  hasSavedConfig: boolean
  setEditingConnectionConfig: (
    value: Record<string, string>
  ) => void
  secret?: boolean
}) {
  return (
    <div className="mt-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--decisionate-brand-primary-text)]">
        {title}
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        {configKeys.map((configKey) => (
          <ConnectionConfigField
            key={configKey}
            configKey={configKey}
            sourceType={sourceType}
            value={
              editingConnectionConfig[
                configKey
              ] ?? ""
            }
            hasSavedConfig={hasSavedConfig}
            secret={secret}
            onChange={(value) =>
              setEditingConnectionConfig({
                ...editingConnectionConfig,
                [configKey]: value,
              })
            }
          />
        ))}
      </div>
    </div>
  )
}

function ConnectionConfigField({
  configKey,
  sourceType,
  value,
  hasSavedConfig,
  secret,
  onChange,
}: {
  configKey: string
  sourceType?: string
  value: string
  hasSavedConfig: boolean
  secret?: boolean
  onChange: (value: string) => void
}) {
  const label =
    formatConnectionConfigKey(configKey)
  const placeholder = hasSavedConfig
    ? `Replace saved ${label.toLowerCase()}`
    : `Enter ${label.toLowerCase()}`
  const sharedClassName =
    "mt-1 min-w-0 w-full rounded-lg border border-[var(--decisionate-brand-primary-ring)] bg-white px-3 text-sm normal-case tracking-normal text-gray-700 focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"

  return (
    <label className="block min-w-0 break-words text-xs font-medium uppercase tracking-wide text-gray-500">
      {label}
      {sourceType === "salesforce" && configKey === "object_type" ? (
        <select
          aria-label="Salesforce dataset"
          value={value}
          onChange={(event) =>
            onChange(event.target.value)
          }
          className={`${sharedClassName} h-9`}
        >
          <option value="">Select dataset</option>
          <option value="Opportunity">Opportunities</option>
          <option value="Account">Accounts</option>
          <option value="Lead">Leads</option>
        </select>
      ) : sourceType === "netsuite" && configKey === "record_type" ? (
        <select
          aria-label="NetSuite record type"
          value={value}
          onChange={(event) =>
            onChange(event.target.value)
          }
          className={`${sharedClassName} h-9`}
        >
          <option value="">Select record type</option>
          <option value="invoice">Invoices</option>
          <option value="customer">Customers</option>
          <option value="sales_order">Sales Orders</option>
        </select>
      ) : configKey === "query" ? (
        <textarea
          value={value}
          onChange={(event) =>
            onChange(
              event.target.value
            )
          }
          className={`${sharedClassName} min-h-24 py-2`}
          placeholder={placeholder}
        />
      ) : (
        <input
          type={secret ? "password" : "text"}
          value={value}
          onChange={(event) =>
            onChange(
              event.target.value
            )
          }
          className={`${sharedClassName} h-9`}
          placeholder={placeholder}
        />
      )}
    </label>
  )
}

function formatConnectionStatus(
  status: DataSourceConnectionStatus
) {
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) =>
      letter.toUpperCase()
    )
}

function formatLastSyncedAt(
  value?: string | null
) {
  if (!value) {
    return "Never"
  }

  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) {
    return "Unknown"
  }

  return new Intl.DateTimeFormat(
    undefined,
    {
      dateStyle: "medium",
      timeStyle: "short",
    }
  ).format(timestamp)
}

function getConnectionStatusClassName(
  status: DataSourceConnectionStatus
) {
  if (status === "connected") {
    return "rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700"
  }

  if (
    status === "needs_setup" ||
    status === "error"
  ) {
    return "rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700"
  }

  return "rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600"
}

function getConnectionSource(
  connection: DataSourceConnection,
  sources: DatasetSourceOption[]
) {
  return sources.find(
    (source) =>
      source.type === connection.source_type
  )
}

function getSourceCredentialKeys(
  source?: DatasetSourceOption
) {
  if (source?.connection_type === "oauth") {
    return []
  }

  return source?.environment_keys ?? []
}

function getEditableConnectionConfigKeys(
  source?: DatasetSourceOption
) {
  const keys = [
    ...(source?.config_keys ?? []),
    ...getSourceCredentialKeys(source),
  ]

  return keys.filter(
    (key, index) =>
      keys.indexOf(key) === index
  )
}

function getExternalCredentialLabel(
  source?: DatasetSourceOption
) {
  if (source?.connection_type === "database") {
    return "Database credentials"
  }

  if (
    source?.connection_type ===
    "object_storage"
  ) {
    return "Storage credentials"
  }

  if (source?.connection_type === "api_key") {
    return "API credentials"
  }

  if (source?.connection_type === "webhook") {
    return "Webhook secret"
  }

  return "OAuth app credentials"
}

function getConnectionConfigHelpText(
  source?: DatasetSourceOption
) {
  if (source?.connection_type === "database") {
    return "Dataset fields select what to import. Credential fields are saved with this connection and hidden after save."
  }

  if (
    source?.connection_type ===
    "object_storage"
  ) {
    return "Dataset fields select the bucket, container, prefix, or file pattern to import. Credential fields are saved with this connection and hidden after save."
  }

  if (source?.connection_type === "api_key") {
    return "Dataset fields identify the account or endpoint. Credential fields are saved with this connection and hidden after save."
  }

  if (source?.connection_type === "webhook") {
    return "Dataset fields identify the incoming event stream. Secret fields are saved with this connection and hidden after save."
  }

  return "Dataset fields identify the account, file, or store. Credential fields are saved with this connection and hidden after save."
}

function formatConnectionConfigKey(
  key: string
) {
  return key
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) =>
      letter.toUpperCase()
    )
}
