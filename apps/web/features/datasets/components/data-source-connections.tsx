"use client"

import {
  useState,
} from "react"

import {
  type DataSourceConnection,
  type DataSourceConnectionStatus,
  type DatasetSourceOption,
} from "@/lib/api"

interface DataSourceConnectionsProps {
  connections: DataSourceConnection[]
  sources?: DatasetSourceOption[]
  deletingConnectionId?: number | null
  updatingConnectionId?: number | null
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
}

export function DataSourceConnections({
  connections,
  sources = [],
  deletingConnectionId,
  updatingConnectionId,
  onDeleteConnection,
  onRenameConnection,
  onConfigureConnection,
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
        No added data source connections yet. Choose Add connection from Data Sources above.
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
  editingConnectionId,
  editingDisplayName,
  setEditingDisplayName,
  startEditing,
  stopEditing,
  saveEditing,
  onDeleteConnection,
  onRenameConnection,
  onConfigureConnection,
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
    credentialKeys.length > 0
  const environmentConfigured =
    connection.environment_configured ??
    source?.environment_configured
  const externalCredentialLabel =
    getExternalCredentialLabel(source)
  const connectionConfigHelpText =
    getConnectionConfigHelpText(source)
  const canConfigure =
    Boolean(
      onConfigureConnection &&
        editableConfigKeys.length > 0
    )
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
          <div className="flex max-w-md flex-wrap gap-2">
            <input
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
              className="rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Save
            </button>

            <button
              type="button"
              onClick={stopEditing}
              className="rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        ) : (
          <h3 className="font-medium">
            {connection.display_name}
          </h3>
        )}

        <p className="mt-1 text-sm text-gray-500">
          {connection.source_label}
        </p>

        {connection.availability_note && (
          <p className="mt-1 text-xs text-amber-700">
            {connection.availability_note}
          </p>
        )}

        <p className="mt-2 text-xs font-medium uppercase text-gray-400">
          {connection.has_config
            ? "Config saved"
            : "No config saved"}
        </p>

        {requiresEnvironmentCredentials && (
          <p
            className={
              environmentConfigured
                ? "mt-1 text-xs text-green-700"
                : "mt-1 text-xs text-amber-700"
            }
          >
            {externalCredentialLabel}:{" "}
            {environmentConfigured
              ? "configured"
              : "not configured"}
          </p>
        )}

        {isConfiguring && (
          <div className="mt-4 max-w-2xl rounded-xl border border-blue-100 bg-blue-50 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-blue-700">
              Configure connection settings
            </p>

            {configKeys.length > 0 && (
              <ConnectionConfigFieldGroup
                title="Dataset Settings"
                configKeys={configKeys}
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

            <p className="mt-2 text-xs text-blue-700">
              Saved values are hidden. Enter replacement values for the fields you want to save.
            </p>

            {requiresEnvironmentCredentials && (
              <p className="mt-1 text-xs text-blue-700">
                {connectionConfigHelpText}
              </p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
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
                className="rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
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
                  className="rounded-lg border border-red-100 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Clear Saved Config
                </button>
              )}

              <button
                type="button"
                onClick={stopConfiguring}
                className="rounded-lg border border-blue-100 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2">
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
            canConfigure) && (
            <div className="flex gap-2">
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
                  className="rounded-lg border px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
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
                  className="rounded-lg border px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
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
                  className="rounded-lg border px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
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
  editingConnectionConfig,
  hasSavedConfig,
  setEditingConnectionConfig,
  secret = false,
}: {
  title: string
  configKeys: string[]
  editingConnectionConfig: Record<string, string>
  hasSavedConfig: boolean
  setEditingConnectionConfig: (
    value: Record<string, string>
  ) => void
  secret?: boolean
}) {
  return (
    <div className="mt-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-blue-700">
        {title}
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        {configKeys.map((configKey) => (
          <ConnectionConfigField
            key={configKey}
            configKey={configKey}
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
  value,
  hasSavedConfig,
  secret,
  onChange,
}: {
  configKey: string
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
    "mt-1 w-full rounded-lg border border-blue-100 bg-white px-3 text-sm normal-case tracking-normal text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"

  return (
    <label className="text-xs font-medium uppercase tracking-wide text-gray-500">
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
    return "Dataset fields select what to import. Database credential fields are saved with this added connection and hidden after save."
  }

  if (source?.connection_type === "api_key") {
    return "Dataset fields identify the account or endpoint. API credential fields are saved with this added connection and hidden after save."
  }

  if (source?.connection_type === "webhook") {
    return "Dataset fields identify the incoming event stream. Webhook secret fields are saved with this added connection and hidden after save."
  }

  return "Dataset fields identify the account, file, or store. OAuth credential fields are saved with this added connection and hidden after save."
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
