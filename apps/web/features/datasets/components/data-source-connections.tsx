"use client"

import { useState } from "react"
import Link from "next/link"
import {
  Database,
  Eye,
  EyeOff,
} from "lucide-react"

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
  onCancelOAuthAuthorization?: (
    connection: DataSourceConnection
  ) => void
  onUpdateSchedule?: (
    connection: DataSourceConnection,
    enabled: boolean,
    intervalHours: number,
    timeOfDay: string,
    timezone: string,
    dayOfWeek: number
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
  onCancelOAuthAuthorization,
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
    if (hasResourceTypeSelection(source)) {
      emptyConfig.resource_types = (
        connection.configured_resource_types ?? []
      ).join(",")
    }
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
          onCancelOAuthAuthorization={
            onCancelOAuthAuthorization
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
  onCancelOAuthAuthorization,
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
  onCancelOAuthAuthorization?: (
    connection: DataSourceConnection
  ) => void
  onUpdateSchedule?: (
    connection: DataSourceConnection,
    enabled: boolean,
    intervalHours: number,
    timeOfDay: string,
    timezone: string,
    dayOfWeek: number
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
    credentialKeys.length > 0 ||
    Boolean(
      source?.provider_setting_keys?.length &&
        source?.connection_type !== "api_key"
    ) ||
    source?.connection_type === "oauth"
  const environmentConfigured =
    connection.environment_configured ??
    source?.environment_configured
  const externalCredentialLabel =
    getExternalCredentialLabel(source)
  const sourceIsPlanned =
    source?.status === "planned"
  const hasResourceSelection =
    hasResourceTypeSelection(source)
  const resourceOptions =
    getResourceSelectionOptions(
      connection.source_type
    )
  const configuredResourceTypes = (
    connection.configured_resource_types ?? []
  ).filter((resource) =>
    resourceOptions.some(
      (option) => option.value === resource
    )
  )
  const defaultResourceTypes =
    getDefaultResourceTypes(
      connection.source_type
    )
  const configuredResourceKey =
    configuredResourceTypes.join(",")
  const selectedResourceTypes =
    configuredResourceTypes.length
      ? configuredResourceTypes
      : defaultResourceTypes
  const syncMetrics = [
    "activeUsers",
    "sessions",
    "totalRevenue",
  ]
  const stripeKeyConfigured =
    connection.source_type !== "stripe" ||
    connection.has_config
  const canConfigure =
    Boolean(
      onConfigureConnection &&
        editableConfigKeys.some(
          (configKey) =>
            configKey !== "resource_types"
        ) &&
        !sourceIsPlanned &&
        source?.connection_type !== "oauth" &&
        source?.connection_type !== "api_key"
    )
  const usesVisibilityToggle =
    VISIBILITY_TOGGLE_SOURCE_TYPES.has(
      connection.source_type
    )
  const inlineConnectionConfigKeys =
    usesVisibilityToggle
      ? editableConfigKeys.filter(
          (configKey) =>
            configKey !== "resource_types"
        )
      : []
  const hasEditedInlineConnectionConfig =
    inlineConnectionConfigKeys.some((configKey) =>
      Boolean(
        editingConnectionConfig[configKey]?.trim()
      )
    )
  const requiredConnectionConfigKeys =
    connection.required_config_keys ??
    source?.required_config_keys ??
    []
  const hasRequiredConnectionConfig =
    requiredConnectionConfigKeys.length === 0 ||
    (Array.isArray(connection.missing_config_keys)
      ? connection.missing_config_keys.length === 0
      : connection.has_config)
  const canSyncConnector =
    [
      "google_analytics",
      "google_ads",
      "hubspot",
      "stripe",
      "shopify",
      "meta_ads",
      "quickbooks",
      "freshbooks",
      "sage",
      "xero",
      "zoho_books",
      "salesforce",
      "postgresql",
      "mysql",
      "sql_server",
    ].includes(
      connection.source_type
    ) &&
    source?.status === "available" &&
    stripeKeyConfigured &&
    hasRequiredConnectionConfig &&
    (source?.connection_type !== "oauth" ||
      connection.status === "connected") &&
    (!hasResourceSelection ||
      selectedResourceTypes.length > 0) &&
    Boolean(onSyncConnection)
  const canStartOAuth =
    source?.connection_type === "oauth" &&
    source.status === "available" &&
    connection.status !== "connected" &&
    Boolean(onStartOAuthConnection)
  const canCancelOAuth =
    source?.connection_type === "oauth" &&
    connection.status === "connected" &&
    Boolean(onCancelOAuthAuthorization)
  const canSchedule =
    source?.sync_modes?.includes("scheduled") === true &&
    Boolean(onUpdateSchedule) &&
    !sourceIsPlanned
  const [scheduleEnabled, setScheduleEnabled] =
    useState(Boolean(connection.sync_enabled))
  const [scheduleIntervalHours, setScheduleIntervalHours] =
    useState(String(connection.sync_interval_hours ?? 24))
  const [scheduleTimeOfDay, setScheduleTimeOfDay] =
    useState(connection.sync_time_of_day ?? "00:00")
  const [scheduleTimezone] =
    useState(connection.sync_timezone ?? "")
  const [scheduleDayOfWeek, setScheduleDayOfWeek] =
    useState(String(connection.sync_day_of_week ?? 0))


  function syncConnection() {
    onSyncConnection?.(
      connection,
      {
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
  const datasetIds = connection.dataset_ids?.length
    ? connection.dataset_ids
    : connection.dataset_id
      ? [connection.dataset_id]
      : []
  const datasetNames = connection.dataset_file_names ?? []

  function handleResourceSelectionChange(
    resource: string,
    checked: boolean
  ) {
    const nextResources = new Set(
      selectedResourceTypes
    )
    if (checked) {
      nextResources.add(resource)
    } else {
      nextResources.delete(resource)
    }

    if (!nextResources.size) {
      return
    }

    const nextSelectedResources = resourceOptions
      .map((option) => option.value)
      .filter((option) => nextResources.has(option))
    onConfigureConnection?.(
      connection,
      {
        resource_types: nextSelectedResources.join(","),
      }
    )
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 bg-white p-4 first:rounded-t-xl last:rounded-b-xl lg:grid-cols-2 lg:items-start">
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
          {hasResourceSelection
            ? selectedResourceTypes.length
              ? "Objects selected"
              : "No objects selected"
            : connection.source_type === "quickbooks"
            ? connection.status === "connected"
              ? "OAuth configured"
              : "OAuth not configured"
            : connection.has_config
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

        {connection.source_type === "stripe" &&
          !connection.has_config && (
            <p className="mt-1 break-words text-xs text-amber-700">
              Enter and save the customer&apos;s read-only Stripe restricted API key before syncing. Without it, no Stripe data will be ingested.
            </p>
          )}

        {requiredConnectionConfigKeys.length > 0 &&
          !hasRequiredConnectionConfig &&
          connection.source_type !== "stripe" && (
            <p className="mt-1 break-words text-xs text-amber-700">
              Enter and save the required connection settings before syncing. Without them, no data will be ingested.
            </p>
          )}

        {isConfiguring && (
          <div className="mt-4 max-w-2xl rounded-xl border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--decisionate-brand-primary-text)]">
              {hasResourceSelection
                ? `${source?.label ?? "Connection"} objects to ingest`
                : "Configure connection settings"}
            </p>

            <p className="mt-2 text-xs leading-4 text-[var(--decisionate-brand-primary-text)]">
              Required settings must be saved before data can be ingested. Without them, this connection will ingest no data.
            </p>

            {configKeys.filter(
              (configKey) =>
                configKey !== "resource_types"
            ).length > 0 && (
              <ConnectionConfigFieldGroup
                title="Dataset Settings"
                configKeys={configKeys.filter(
                  (configKey) =>
                    configKey !== "resource_types"
                )}
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
                secret={connection.source_type === "stripe"}
              />
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

      </div>

      <div className="flex w-full min-w-0 shrink-0 flex-col items-start gap-2 lg:max-w-xl lg:items-end">
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
            canStartOAuth ||
            canCancelOAuth) && (
            <div className="flex w-full min-w-0 flex-wrap items-center justify-start gap-2 lg:justify-end">
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
                      connection.id
                  }
                  className="w-full rounded-lg border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] px-3 py-1.5 text-xs font-medium text-[var(--decisionate-brand-primary-text)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {syncingConnectionId ===
                  connection.id
                    ? "Syncing..."
                    : "Sync now"}
                </button>
              )}

              {datasetIds.length > 0 && (
                <div className="flex min-w-0 w-full flex-wrap items-center gap-2 sm:w-auto">
                  {datasetIds.length === 1 ? (
                    <>
                      <span className="whitespace-nowrap text-xs text-gray-500">
                        1 dataset
                      </span>
                      <Link
                        href={`/dashboard/datasets/${datasetIds[0]}`}
                        className="inline-flex min-w-0 max-w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--decisionate-brand-primary-ring)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--decisionate-brand-primary-text)] hover:bg-[var(--decisionate-brand-primary-soft)]"
                      >
                        <Database size={14} />
                        <span className="max-w-48 truncate">
                          {datasetNames[0]
                            ? `Go to ${datasetNames[0]}`
                            : "Go to dataset"}
                        </span>
                      </Link>
                    </>
                  ) : (
                    <>
                      <label
                        className="sr-only"
                        htmlFor={`connection-dataset-${connection.id}`}
                      >
                        Go to dataset
                      </label>
                      <select
                        id={`connection-dataset-${connection.id}`}
                        defaultValue=""
                        onChange={(event) => {
                          const datasetId = event.target.value
                          if (datasetId) {
                            window.location.assign(
                              `/dashboard/datasets/${datasetId}`
                            )
                          }
                        }}
                        className="h-8 max-w-48 min-w-0 rounded-lg border border-gray-300 bg-white px-2 text-xs text-gray-700"
                      >
                        <option value="">Go to dataset</option>
                        {datasetIds.map((datasetId, index) => (
                          <option key={datasetId} value={datasetId}>
                            {datasetNames[index] ?? `Dataset ${index + 1}`}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
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

              {canCancelOAuth && (
                <button
                  type="button"
                  onClick={() =>
                    onCancelOAuthAuthorization?.(connection)
                  }
                  disabled={
                    updatingConnectionId === connection.id
                  }
                  className="w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {updatingConnectionId === connection.id
                    ? "Cancelling..."
                    : "Cancel authorization"}
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
                    ? "Hide settings"
                    : hasRequiredConnectionConfig
                      ? "Show settings"
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

      {canSchedule && (
        <div className="h-full min-w-0 rounded-xl border bg-gray-50 p-3 lg:col-start-1 lg:row-start-2">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
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
              Frequency
              <select
                value={scheduleIntervalHours}
                onChange={(event) =>
                  setScheduleIntervalHours(event.target.value)
                }
                className="h-9 rounded-lg border border-gray-300 bg-white px-2 text-sm text-gray-700"
              >
                <option value="24">Daily</option>
                <option value="168">Weekly</option>
              </select>
            </label>

            {scheduleIntervalHours === "168" && (
              <label className="inline-flex h-9 items-center gap-2 text-xs font-medium text-gray-600">
                On
                <select
                  value={scheduleDayOfWeek}
                  onChange={(event) =>
                    setScheduleDayOfWeek(event.target.value)
                  }
                  className="h-9 rounded-lg border border-gray-300 bg-white px-2 text-sm text-gray-700"
                >
                  {[
                    [0, "Sunday"],
                    [1, "Monday"],
                    [2, "Tuesday"],
                    [3, "Wednesday"],
                    [4, "Thursday"],
                    [5, "Friday"],
                    [6, "Saturday"],
                  ].map(([day, label]) => (
                    <option key={day} value={day}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}

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
                  scheduleTimezone || getBrowserTimezone(),
                  Number(scheduleDayOfWeek)
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

      {inlineConnectionConfigKeys.length > 0 && (
          <div
            id={`connection-settings-${connection.id}`}
            className="h-full min-w-0 lg:col-start-2 lg:row-start-2"
          >
            <div className="h-full rounded-xl border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] p-3">
              <ConnectionConfigFieldGroup
                title="Connection settings"
                configKeys={inlineConnectionConfigKeys}
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
                secret={connection.source_type === "stripe"}
              />

              {connection.source_type === "meta_ads" && (
                <p className="mt-2 text-xs text-[var(--decisionate-brand-primary-text)]">
                  A Meta Ads account ID is required to create a usable connection and sync data.
                </p>
              )}

              {connection.source_type === "google_ads" && (
                <p className="mt-2 text-xs text-[var(--decisionate-brand-primary-text)]">
                  A Google Ads customer ID is required before data can be ingested. The manager account ID is only needed when access is through a manager account.
                </p>
              )}

              <p className="mt-2 text-xs leading-4 text-[var(--decisionate-brand-primary-text)]">
                Save the required setting before data can be ingested. Without it, this connection will ingest no data.
              </p>

              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <button
                  type="button"
                  onClick={() => saveConfiguration(connection)}
                  disabled={
                    updatingConnectionId ===
                      connection.id ||
                      !hasEditedInlineConnectionConfig
                  }
                  className="w-full rounded-lg border border-[var(--decisionate-brand-primary-ring)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--decisionate-brand-primary-text)] hover:bg-[var(--decisionate-brand-primary-soft)] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {updatingConnectionId ===
                  connection.id
                    ? "Saving..."
                    : "Save settings"}
                </button>

                {connection.has_config && (
                  <button
                    type="button"
                    onClick={() => clearConfiguration(connection)}
                    disabled={
                      updatingConnectionId ===
                      connection.id
                    }
                    className="w-full rounded-lg border border-red-100 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  >
                    Clear saved settings
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

      {hasResourceSelection &&
        resourceOptions.length > 0 && (
          <div className="h-full min-w-0 lg:col-start-2 lg:row-start-2">
            <ConnectionResourceSelector
              key={`${connection.id}-${configuredResourceKey}`}
              sourceType={connection.source_type}
              options={resourceOptions}
              selectedValues={selectedResourceTypes}
              disabled={
                !onConfigureConnection ||
                sourceIsPlanned ||
                updatingConnectionId === connection.id
              }
              onChange={
                handleResourceSelectionChange
              }
            />
          </div>
        )}
    </div>
  )
}

type ConnectionFieldGuide = {
  description: string
  example: string
}

const VISIBILITY_TOGGLE_SOURCE_TYPES = new Set([
  "shopify",
  "google_analytics",
  "google_ads",
  "meta_ads",
  "stripe",
])

const FRESHBOOKS_RESOURCE_OPTIONS = [
  { value: "profile", label: "Profile" },
  { value: "invoices", label: "Invoices" },
  { value: "expenses", label: "Expenses" },
  { value: "payments", label: "Payments" },
  { value: "clients", label: "Clients" },
  { value: "chart_of_accounts", label: "Chart of accounts" },
  { value: "credit_notes", label: "Credit notes" },
  { value: "projects", label: "Projects" },
]

const QUICKBOOKS_RESOURCE_OPTIONS = [
  { value: "invoices", label: "Invoices" },
  { value: "customers", label: "Customers" },
  { value: "payments", label: "Payments" },
  { value: "sales_receipts", label: "Sales receipts" },
  { value: "estimates", label: "Estimates" },
  { value: "bills", label: "Bills" },
  { value: "purchases", label: "Purchases / expenses" },
  { value: "vendors", label: "Vendors" },
  { value: "products_services", label: "Products and services" },
  { value: "accounts", label: "Accounts" },
]

const XERO_RESOURCE_OPTIONS = [
  { value: "invoices", label: "Invoices" },
  { value: "contacts", label: "Contacts" },
  { value: "payments", label: "Payments" },
  { value: "credit_notes", label: "Credit notes" },
  { value: "quotes", label: "Quotes" },
  { value: "purchase_orders", label: "Purchase orders" },
  { value: "accounts", label: "Accounts / chart of accounts" },
  { value: "items", label: "Items / products and services" },
]

const ZOHO_BOOKS_RESOURCE_OPTIONS = [
  { value: "invoices", label: "Invoices" },
  { value: "contacts", label: "Contacts" },
  { value: "expenses", label: "Expenses" },
  { value: "customer_payments", label: "Customer payments" },
  { value: "credit_notes", label: "Credit notes" },
  { value: "estimates", label: "Estimates" },
  { value: "sales_orders", label: "Sales orders" },
  { value: "projects", label: "Projects" },
  { value: "items", label: "Items / products and services" },
]

const SAGE_RESOURCE_OPTIONS = [
  { value: "sales_invoices", label: "Sales invoices" },
  { value: "purchase_invoices", label: "Purchase invoices" },
  { value: "sales_credit_notes", label: "Sales credit notes" },
  { value: "purchase_credit_notes", label: "Purchase credit notes" },
  { value: "contacts", label: "Contacts" },
  { value: "ledger_accounts", label: "Ledger accounts" },
  { value: "products", label: "Products" },
  { value: "services", label: "Services" },
  { value: "bank_accounts", label: "Bank accounts" },
  { value: "payments", label: "Contact payments" },
  { value: "other_payments", label: "Other payments" },
  { value: "journals", label: "Journals" },
]

const HUBSPOT_RESOURCE_OPTIONS = [
  { value: "contacts", label: "Contacts" },
  { value: "companies", label: "Companies" },
  { value: "deals", label: "Deals" },
  { value: "tickets", label: "Tickets" },
]

const SALESFORCE_RESOURCE_OPTIONS = [
  { value: "accounts", label: "Accounts" },
  { value: "leads", label: "Leads" },
  { value: "opportunities", label: "Opportunities" },
]

type ResourceSelectionOption = {
  value: string
  label: string
}

function getResourceSelectionOptions(
  sourceType: string
): ResourceSelectionOption[] {
  switch (sourceType) {
    case "freshbooks":
      return FRESHBOOKS_RESOURCE_OPTIONS
    case "quickbooks":
      return QUICKBOOKS_RESOURCE_OPTIONS
    case "xero":
      return XERO_RESOURCE_OPTIONS
    case "zoho_books":
      return ZOHO_BOOKS_RESOURCE_OPTIONS
    case "sage":
      return SAGE_RESOURCE_OPTIONS
    case "hubspot":
      return HUBSPOT_RESOURCE_OPTIONS
    case "salesforce":
      return SALESFORCE_RESOURCE_OPTIONS
    default:
      return []
  }
}

function getDefaultResourceTypes(
  sourceType: string
): string[] {
  switch (sourceType) {
    case "hubspot":
      return ["deals"]
    case "salesforce":
      return ["opportunities"]
    case "freshbooks":
    case "quickbooks":
    case "xero":
    case "zoho_books":
      return ["invoices"]
    case "sage":
      return ["sales_invoices"]
    default:
      return []
  }
}

function getResourceSelectionTitle(
  sourceType: string
) {
  switch (sourceType) {
    case "freshbooks":
      return "FreshBooks objects to ingest"
    case "quickbooks":
      return "QuickBooks resources to ingest"
    case "xero":
      return "Xero objects to ingest"
    case "zoho_books":
      return "Zoho Books objects to ingest"
    case "sage":
      return "Sage Cloud Accounting objects to ingest"
    case "hubspot":
      return "HubSpot objects to ingest"
    case "salesforce":
      return "Salesforce objects to ingest"
    default:
      return "Objects to ingest"
  }
}

function ConnectionResourceSelector({
  sourceType,
  options,
  selectedValues,
  disabled,
  onChange,
}: {
  sourceType: string
  options: ResourceSelectionOption[]
  selectedValues: string[]
  disabled: boolean
  onChange: (resource: string, checked: boolean) => void
}) {
  const [selectedResourceValues, setSelectedResourceValues] =
    useState(selectedValues)
  const selectedResources = new Set(
    selectedResourceValues
  )

  function handleChange(
    resource: string,
    checked: boolean
  ) {
    const nextResources = new Set(
      selectedResourceValues
    )
    if (checked) {
      nextResources.add(resource)
    } else {
      nextResources.delete(resource)
    }

    if (!nextResources.size) {
      return
    }

    const nextSelectedValues = options
      .map((option) => option.value)
      .filter((option) => nextResources.has(option))
    setSelectedResourceValues(nextSelectedValues)
    onChange(resource, checked)
  }

  return (
    <fieldset className="h-full min-w-0 rounded-xl border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] p-3">
      <legend className="px-1 text-xs font-medium uppercase tracking-wide text-[var(--decisionate-brand-primary-text)]">
        {getResourceSelectionTitle(sourceType)}
      </legend>
      <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {options.map((option) => (
          <label
            key={option.value}
            title={
              selectedResourceValues.length === 1 &&
              selectedResources.has(option.value)
                ? "At least one object must remain selected"
                : undefined
            }
            className="flex min-w-0 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700"
          >
            <input
              type="checkbox"
              checked={selectedResources.has(option.value)}
              disabled={
                disabled ||
                (selectedResourceValues.length === 1 &&
                  selectedResources.has(option.value))
              }
              onChange={(event) =>
                handleChange(
                  option.value,
                  event.target.checked
                )
              }
              className="h-4 w-4 shrink-0 rounded border-gray-300 text-[var(--decisionate-brand-primary)] focus:ring-[var(--decisionate-brand-primary-ring)]"
            />
            <span className="min-w-0 break-words">
              {option.label}
            </span>
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs text-[var(--decisionate-brand-primary-text)]">
        At least one object is required. Each selected object creates or updates a separate dataset.
      </p>
    </fieldset>
  )
}

const CONNECTION_FIELD_GUIDES: Record<
  string,
  Record<string, ConnectionFieldGuide>
> = {
  google_analytics: {
    property_id: {
      description: "The numeric GA4 property ID that owns the reports.",
      example: "123456789",
    },
  },
  google_ads: {
    customer_id: {
      description: "The 10-digit Google Ads customer account ID to query. Hyphens are accepted and removed automatically.",
      example: "1234567890",
    },
    login_customer_id: {
      description: "Optional 10-digit manager account ID. Enter it when the authorized Google user reaches the customer account through a manager account; leave blank for direct access.",
      example: "0987654321",
    },
  },
  postgresql: {
    connection_name: {
      description: "A name for this read-only database connection.",
      example: "Reporting database",
    },
    query: {
      description: "One read-only SELECT or WITH query using your own table and column names.",
      example: "SELECT order_date, amount FROM public.orders",
    },
  },
  mysql: {
    connection_name: {
      description: "A name for this read-only database connection.",
      example: "Reporting database",
    },
    query: {
      description: "One read-only SELECT or WITH query using your own table and column names.",
      example: "SELECT order_date, amount FROM orders",
    },
  },
  sql_server: {
    connection_name: {
      description: "A name for this read-only database connection.",
      example: "Reporting database",
    },
    query: {
      description: "One read-only SELECT or WITH query using your own table and column names.",
      example: "SELECT order_date, amount FROM dbo.orders",
    },
  },
  stripe: {
    api_key: {
      description: "A restricted, read-only API key from the customer's own Stripe account. Do not use a Stripe Connect account ID.",
      example: "rk_test_...",
    },
  },
  shopify: {
    shop_domain: {
      description: "The Shopify store domain used for OAuth authorization.",
      example: "your-store.myshopify.com",
    },
  },
  freshbooks: {
    resource_types: {
      description: "Select one or more FreshBooks objects. Each selected object is stored as its own dataset.",
      example: "Invoices, Expenses",
    },
  },
  quickbooks: {
    resource_types: {
      description: "Select one or more QuickBooks resources. Each selected resource is stored as its own dataset.",
      example: "Invoices, Customers",
    },
  },
  zoho_books: {
    resource_types: {
      description: "Select one or more Zoho Books objects. Each selected object is stored as its own dataset; the organization is selected automatically after OAuth authorization.",
      example: "Invoices, Contacts",
    },
  },
  xero: {
    resource_types: {
      description: "Select one or more Xero resources. Each selected resource is stored as its own dataset after OAuth authorization.",
      example: "Invoices, Contacts",
    },
  },
  sage: {
    resource_types: {
      description: "Select one or more Sage Cloud Accounting objects. Each selected object is stored as its own dataset after OAuth authorization.",
      example: "Sales invoices, Contacts, Ledger accounts",
    },
  },
  hubspot: {
    resource_types: {
      description: "Select one or more HubSpot CRM objects. Each selected object is stored as its own dataset after OAuth authorization.",
      example: "Contacts, Deals",
    },
  },
  salesforce: {
    resource_types: {
      description: "Select one or more Salesforce Sales Cloud objects. Each selected object is stored as its own dataset.",
      example: "Accounts, Opportunities",
    },
  },
  meta_ads: {
    ad_account_id: {
      description: "Required to create a usable Meta Ads connection and sync data. The act_ prefix is accepted or added.",
      example: "act_123456789012345",
    },
  },
}

function getConnectionFieldGuide(
  sourceType: string | undefined,
  configKey: string
) {
  return (
    CONNECTION_FIELD_GUIDES[sourceType ?? ""]?.[configKey] ?? {
      description: "Enter the value provided by this data source.",
      example: "Use the value shown in the provider account",
    }
  )
}

export function ConnectionSetupGuide({
  source,
  compact = false,
}: {
  source?: DatasetSourceOption
  compact?: boolean
}) {
  if (!source) {
    return null
  }

  const configKeys = source.config_keys ?? []
  const fieldGuides = configKeys.map((configKey) => ({
    configKey,
    ...getConnectionFieldGuide(source.type, configKey),
  }))

  if (!fieldGuides.length) {
    return null
  }

  return (
    <details
      open={!compact}
      className={
        compact
          ? "mt-3 w-full min-w-0 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
          : "mt-3 w-full min-w-0 rounded-lg border border-blue-100 bg-white/70 px-3 py-2"
      }
    >
      <summary className="cursor-pointer text-xs font-semibold text-gray-700">
        What to enter and example values
      </summary>

      <div className="mt-3 space-y-3 text-xs text-gray-600">
        {fieldGuides.length > 0 && (
          <div>
            <p className="font-semibold text-gray-800">
              Enter in this connection
            </p>
            <div className="mt-2 grid min-w-0 gap-2 sm:grid-cols-2">
              {fieldGuides.map((field) => (
                <div
                  key={field.configKey}
                  className="min-w-0 rounded-md border border-gray-200 bg-white p-2"
                >
                  <p className="font-semibold text-gray-800">
                    {formatConnectionConfigLabel(
                      field.configKey,
                      source.type
                    )}
                  </p>
                  <p className="mt-1 leading-4">
                    {field.description}
                  </p>
                  <p className="mt-1 break-words font-mono text-[10px] text-blue-700">
                    Example: {field.example}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {source.connection_type === "oauth" && (
          <p className="rounded-md bg-blue-50 px-2 py-2 leading-4 text-blue-800">
            {hasResourceTypeSelection(source)
              ? `Use Connect with OAuth to authorize the provider account, then select the ${source.label} objects to ingest.`
              : "Save the connection fields first, then use Connect with OAuth to authorize the provider account."}
          </p>
        )}

        {source.connection_type === "database" && (
          <p className="rounded-md bg-amber-50 px-2 py-2 leading-4 text-amber-800">
            The query must be a single read-only SELECT or WITH statement and should use the tables and columns in your database.
          </p>
        )}
      </div>
    </details>
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
  const [showValue, setShowValue] = useState(false)
  const label = formatConnectionConfigLabel(
    configKey,
    sourceType
  )
  const fieldGuide = getConnectionFieldGuide(
    sourceType,
    configKey
  )
  const placeholder = hasSavedConfig
    ? `Replace saved ${label.toLowerCase()}`
    : fieldGuide.example
  const sharedClassName =
    "mt-1 min-w-0 w-full rounded-lg border border-[var(--decisionate-brand-primary-ring)] bg-white px-3 text-sm normal-case tracking-normal text-gray-700 focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
  const maskValue =
    secret ||
    hasSavedConfig ||
    VISIBILITY_TOGGLE_SOURCE_TYPES.has(
      sourceType ?? ""
    )
  const valueVisibilityLabel = showValue
    ? `Hide ${label.toLowerCase()}`
    : `Show ${label.toLowerCase()}`

  if (sourceType === "salesforce" && configKey === "resource_types") {
    const selectedResources = new Set(
      value
        .split(",")
        .map((resource) => resource.trim())
        .filter(Boolean)
    )

    return (
      <fieldset className="min-w-0 break-words text-xs font-medium uppercase tracking-wide text-gray-500">
        <legend>Salesforce objects to ingest</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {SALESFORCE_RESOURCE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex min-w-0 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 normal-case tracking-normal text-gray-700"
            >
              <input
                type="checkbox"
                checked={selectedResources.has(option.value)}
                onChange={(event) => {
                  const nextResources = new Set(selectedResources)
                  if (event.target.checked) {
                    nextResources.add(option.value)
                  } else {
                    nextResources.delete(option.value)
                  }
                  onChange(
                    SALESFORCE_RESOURCE_OPTIONS
                      .map((item) => item.value)
                      .filter((item) => nextResources.has(item))
                      .join(",")
                  )
                }}
                className="h-4 w-4 rounded border-gray-300 text-[var(--decisionate-brand-primary)] focus:ring-[var(--decisionate-brand-primary-ring)]"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        <p className="mt-2 normal-case tracking-normal text-gray-500">
          Each checked object creates or updates a separate dataset.
        </p>
      </fieldset>
    )
  }

  if (sourceType === "freshbooks" && configKey === "resource_types") {
    const selectedResources = new Set(
      value
        .split(",")
        .map((resource) => resource.trim())
        .filter(Boolean)
    )

    return (
      <fieldset className="min-w-0 break-words text-xs font-medium uppercase tracking-wide text-gray-500">
        <legend>FreshBooks objects to ingest</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {FRESHBOOKS_RESOURCE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex min-w-0 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 normal-case tracking-normal text-gray-700"
            >
              <input
                type="checkbox"
                checked={selectedResources.has(option.value)}
                onChange={(event) => {
                  const nextResources = new Set(selectedResources)
                  if (event.target.checked) {
                    nextResources.add(option.value)
                  } else {
                    nextResources.delete(option.value)
                  }
                  onChange(
                    FRESHBOOKS_RESOURCE_OPTIONS
                      .map((item) => item.value)
                      .filter((item) => nextResources.has(item))
                      .join(",")
                  )
                }}
                className="h-4 w-4 rounded border-gray-300 text-[var(--decisionate-brand-primary)] focus:ring-[var(--decisionate-brand-primary-ring)]"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        <p className="mt-2 normal-case tracking-normal text-gray-500">
          Each checked object creates or updates a separate dataset.
        </p>
      </fieldset>
    )
  }

  if (sourceType === "quickbooks" && configKey === "resource_types") {
    const selectedResources = new Set(
      value
        .split(",")
        .map((resource) => resource.trim())
        .filter(Boolean)
    )

    return (
      <fieldset className="min-w-0 break-words text-xs font-medium uppercase tracking-wide text-gray-500">
        <legend>QuickBooks resources to ingest</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {QUICKBOOKS_RESOURCE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex min-w-0 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 normal-case tracking-normal text-gray-700"
            >
              <input
                type="checkbox"
                checked={selectedResources.has(option.value)}
                onChange={(event) => {
                  const nextResources = new Set(selectedResources)
                  if (event.target.checked) {
                    nextResources.add(option.value)
                  } else {
                    nextResources.delete(option.value)
                  }
                  onChange(
                    QUICKBOOKS_RESOURCE_OPTIONS
                      .map((item) => item.value)
                      .filter((item) => nextResources.has(item))
                      .join(",")
                  )
                }}
                className="h-4 w-4 rounded border-gray-300 text-[var(--decisionate-brand-primary)] focus:ring-[var(--decisionate-brand-primary-ring)]"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        <p className="mt-2 normal-case tracking-normal text-gray-500">
          Each checked resource creates or updates a separate dataset.
        </p>
      </fieldset>
    )
  }

  if (sourceType === "xero" && configKey === "resource_types") {
    const selectedResources = new Set(
      value
        .split(",")
        .map((resource) => resource.trim())
        .filter(Boolean)
    )

    return (
      <fieldset className="min-w-0 break-words text-xs font-medium uppercase tracking-wide text-gray-500">
        <legend>Xero objects to ingest</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {XERO_RESOURCE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex min-w-0 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 normal-case tracking-normal text-gray-700"
            >
              <input
                type="checkbox"
                checked={selectedResources.has(option.value)}
                onChange={(event) => {
                  const nextResources = new Set(selectedResources)
                  if (event.target.checked) {
                    nextResources.add(option.value)
                  } else {
                    nextResources.delete(option.value)
                  }
                  onChange(
                    XERO_RESOURCE_OPTIONS
                      .map((item) => item.value)
                      .filter((item) => nextResources.has(item))
                      .join(",")
                  )
                }}
                className="h-4 w-4 rounded border-gray-300 text-[var(--decisionate-brand-primary)] focus:ring-[var(--decisionate-brand-primary-ring)]"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        <p className="mt-2 normal-case tracking-normal text-gray-500">
          Each checked object creates or updates a separate dataset.
        </p>
      </fieldset>
    )
  }

  if (sourceType === "zoho_books" && configKey === "resource_types") {
    const selectedResources = new Set(
      value
        .split(",")
        .map((resource) => resource.trim())
        .filter(Boolean)
    )

    return (
      <fieldset className="min-w-0 break-words text-xs font-medium uppercase tracking-wide text-gray-500">
        <legend>Zoho Books objects to ingest</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {ZOHO_BOOKS_RESOURCE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex min-w-0 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 normal-case tracking-normal text-gray-700"
            >
              <input
                type="checkbox"
                checked={selectedResources.has(option.value)}
                onChange={(event) => {
                  const nextResources = new Set(selectedResources)
                  if (event.target.checked) {
                    nextResources.add(option.value)
                  } else {
                    nextResources.delete(option.value)
                  }
                  onChange(
                    ZOHO_BOOKS_RESOURCE_OPTIONS
                      .map((item) => item.value)
                      .filter((item) => nextResources.has(item))
                      .join(",")
                  )
                }}
                className="h-4 w-4 rounded border-gray-300 text-[var(--decisionate-brand-primary)] focus:ring-[var(--decisionate-brand-primary-ring)]"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        <p className="mt-2 normal-case tracking-normal text-gray-500">
          Each checked object creates or updates a separate dataset.
        </p>
      </fieldset>
    )
  }

  if (sourceType === "sage" && configKey === "resource_types") {
    const selectedResources = new Set(
      value
        .split(",")
        .map((resource) => resource.trim())
        .filter(Boolean)
    )

    return (
      <fieldset className="min-w-0 break-words text-xs font-medium uppercase tracking-wide text-gray-500">
        <legend>Sage Cloud Accounting objects to ingest</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {SAGE_RESOURCE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex min-w-0 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 normal-case tracking-normal text-gray-700"
            >
              <input
                type="checkbox"
                checked={selectedResources.has(option.value)}
                onChange={(event) => {
                  const nextResources = new Set(selectedResources)
                  if (event.target.checked) {
                    nextResources.add(option.value)
                  } else {
                    nextResources.delete(option.value)
                  }
                  if (!nextResources.size) return
                  onChange(
                    SAGE_RESOURCE_OPTIONS
                      .map((item) => item.value)
                      .filter((item) => nextResources.has(item))
                      .join(",")
                  )
                }}
                className="h-4 w-4 rounded border-gray-300 text-[var(--decisionate-brand-primary)] focus:ring-[var(--decisionate-brand-primary-ring)]"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        <p className="mt-2 normal-case tracking-normal text-gray-500">
          At least one object is required. Each checked object creates or updates a separate dataset.
        </p>
      </fieldset>
    )
  }

  if (sourceType === "hubspot" && configKey === "resource_types") {
    const selectedResources = new Set(
      value
        .split(",")
        .map((resource) => resource.trim())
        .filter(Boolean)
    )

    return (
      <fieldset className="min-w-0 break-words text-xs font-medium uppercase tracking-wide text-gray-500">
        <legend>HubSpot objects to ingest</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {HUBSPOT_RESOURCE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex min-w-0 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 normal-case tracking-normal text-gray-700"
            >
              <input
                type="checkbox"
                checked={selectedResources.has(option.value)}
                onChange={(event) => {
                  const nextResources = new Set(selectedResources)
                  if (event.target.checked) {
                    nextResources.add(option.value)
                  } else {
                    nextResources.delete(option.value)
                  }
                  onChange(
                    HUBSPOT_RESOURCE_OPTIONS
                      .map((item) => item.value)
                      .filter((item) => nextResources.has(item))
                      .join(",")
                  )
                }}
                className="h-4 w-4 rounded border-gray-300 text-[var(--decisionate-brand-primary)] focus:ring-[var(--decisionate-brand-primary-ring)]"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        <p className="mt-2 normal-case tracking-normal text-gray-500">
          Each checked object creates or updates a separate dataset.
        </p>
      </fieldset>
    )
  }

  return (
    <label className="block min-w-0 break-words text-xs font-medium uppercase tracking-wide text-gray-500">
      {label}
      {configKey === "query" ? (
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
        <div className="relative mt-1 min-w-0">
          <input
            type={maskValue && !showValue ? "password" : "text"}
            value={value}
            onChange={(event) =>
              onChange(
                event.target.value
              )
            }
            className={`${sharedClassName} mt-0 h-9 ${maskValue ? "pr-10" : ""}`}
            placeholder={placeholder}
          />
          {maskValue && (
            <button
              type="button"
              aria-label={valueVisibilityLabel}
              aria-pressed={showValue}
              onClick={() =>
                setShowValue((visible) => !visible)
              }
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            >
              {showValue ? (
                <EyeOff size={16} />
              ) : (
                <Eye size={16} />
              )}
            </button>
          )}
        </div>
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
  return [...(source?.config_keys ?? [])]
}

function hasResourceTypeSelection(
  source?: DatasetSourceOption
) {
  return source?.config_keys?.includes("resource_types") === true
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

function formatConnectionConfigKey(
  key: string
) {
  return key
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) =>
      letter.toUpperCase()
    )
}

function formatConnectionConfigLabel(
  key: string,
  sourceType?: string
) {
  if (sourceType === "google_ads") {
    if (key === "customer_id") {
      return "Customer account ID"
    }

    if (key === "login_customer_id") {
      return "Manager account ID (optional)"
    }
  }

  return formatConnectionConfigKey(key)
}
