"use client"

import { useEffect, useState } from "react"
import { useUser } from "@clerk/nextjs"

import {
  DataSourceConnections,
  REQUIRED_CONNECTION_CONFIG_KEYS,
  type DataSourceConnectionFeedback,
} from "@/features/datasets/components/data-source-connections"
import { DataSourcePanel } from "@/features/datasets/components/data-source-panel"
import { DashboardPageHeader } from "@/features/dashboard/components/dashboard-page-header"
import {
  cancelOAuthAuthorization,
  createDataSourceConnection,
  deleteDataSourceConnection,
  getDataSourceConnections,
  getDatasetSources,
  syncDataSourceConnection,
  startOAuthConnection,
  updateDataSourceConnectionSchedule,
  updateDataSourceConnection,
  type DataSourceConnection,
  type DataSourceConnectionSyncPayload,
  type DatasetSourceOption,
} from "@/lib/api"
import {
  useActiveWorkspace,
} from "@/lib/use-active-workspace"
import {
  useWorkspaceAccess,
} from "@/lib/use-workspace-access"

function getErrorMessage(
  error: unknown,
  fallback: string
) {
  return error instanceof Error &&
    error.message
    ? error.message
    : fallback
}

function getRequiredConnectionConfigKeys(
  connection: DataSourceConnection,
  sources: DatasetSourceOption[]
) {
  const source = sources.find(
    (candidate) =>
      candidate.type === connection.source_type
  )

  return Array.from(
    new Set([
      ...(REQUIRED_CONNECTION_CONFIG_KEYS[
        connection.source_type
      ] ?? []),
      ...(source?.required_config_keys ?? []),
      ...(connection.required_config_keys ?? []),
    ])
  )
}

function getMissingRequiredConnectionConfigKeys(
  connection: DataSourceConnection,
  sources: DatasetSourceOption[]
) {
  const requiredConfigKeys =
    getRequiredConnectionConfigKeys(
      connection,
      sources
    )

  if (requiredConfigKeys.length === 0) {
    return []
  }

  if (
    Array.isArray(
      connection.configured_config_keys
    )
  ) {
    return requiredConfigKeys.filter(
      (configKey) =>
        !connection.configured_config_keys?.includes(
          configKey
        )
    )
  }

  if (
    Array.isArray(connection.missing_config_keys) &&
    connection.missing_config_keys.length > 0
  ) {
    return connection.missing_config_keys
  }

  return requiredConfigKeys
}

function isNoDataMessage(message: string) {
  const normalizedMessage = message.toLowerCase()
  return (
    /\bno\s+(records?|data|rows?|results?|transactions?|items?|entries?)\b/.test(
      normalizedMessage
    ) ||
    /\b(returned|found|available)\s+no\b/.test(
      normalizedMessage
    ) ||
    /\b(empty|zero)\s+(dataset|result|response|records?|rows?)\b/.test(
      normalizedMessage
    ) ||
    normalizedMessage.includes(
      "nothing to ingest"
    ) ||
    /no[_ -]?data/.test(normalizedMessage)
  )
}

function isInternalApiErrorMessage(message: string) {
  const normalizedMessage = message.toLowerCase()
  return (
    normalizedMessage.includes(
      "api service returned an error"
    ) ||
    normalizedMessage.includes(
      "api service is unavailable"
    ) ||
    normalizedMessage.includes(
      "the service is temporarily unavailable"
    ) ||
    normalizedMessage.includes(
      "api request timed out"
    ) ||
    normalizedMessage.includes(
      "the service is taking longer than expected"
    ) ||
    normalizedMessage.includes(
      "check that the backend"
    ) ||
    normalizedMessage.includes(
      "check the backend logs"
    )
  )
}

function getCustomerFacingConnectionError(
  error: unknown,
  fallback: string
) {
  const message = getErrorMessage(
    error,
    fallback
  )
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error
      ? error.status
      : undefined
  const isServerError =
    typeof status === "number" && status >= 500

  return isServerError ||
    isInternalApiErrorMessage(message)
    ? fallback
    : message
}

export default function ConnectionsPage() {
  const { user } = useUser()
  const {
    canConfigureWorkspace,
    canViewConnections,
    loadingWorkspaceAccess,
  } = useWorkspaceAccess(user?.id)

  if (loadingWorkspaceAccess) {
    return (
      <div className="space-y-6">
        <DashboardPageHeader
          title="Connections"
          description="Review external data source connections for this workspace. Configuration and synchronization are managed by the workspace owner."
        />
        <div
          role="status"
          className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500"
        >
          Checking workspace access...
        </div>
      </div>
    )
  }

  if (!canViewConnections) {
    return (
      <div className="space-y-6">
        <DashboardPageHeader
          title="Connections"
          description="Review external data source connections for this workspace. Configuration and synchronization are managed by the workspace owner."
        />
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          Connection access is not available to workspace members.
        </div>
      </div>
    )
  }

  return (
    <ConnectionsPageContent
      canConfigureWorkspace={canConfigureWorkspace}
      canViewConnections={canViewConnections}
      loadingWorkspaceAccess={loadingWorkspaceAccess}
    />
  )
}

function ConnectionsPageContent({
  canConfigureWorkspace,
  canViewConnections,
  loadingWorkspaceAccess,
}: {
  canConfigureWorkspace: boolean
  canViewConnections: boolean
  loadingWorkspaceAccess: boolean
}) {
  const [sources, setSources] =
    useState<DatasetSourceOption[]>([])
  const [
    sourceConnections,
    setSourceConnections,
  ] = useState<DataSourceConnection[]>([])
  const [
    creatingSourceType,
    setCreatingSourceType,
  ] = useState<string | null>(null)
  const [
    deletingConnectionId,
    setDeletingConnectionId,
  ] = useState<number | null>(null)
  const [
    updatingConnectionId,
    setUpdatingConnectionId,
  ] = useState<number | null>(null)
  const [
    syncingConnectionId,
    setSyncingConnectionId,
  ] = useState<number | null>(null)
  const [connectionError, setConnectionError] =
    useState("")
  const [connectionNotice, setConnectionNotice] =
    useState("")
  const [connectionFeedback, setConnectionFeedback] =
    useState<
      Record<number, DataSourceConnectionFeedback>
    >({})
  const [, setOAuthConnectionId] =
    useState<number | null>(null)
  const [connectionLoadError, setConnectionLoadError] =
    useState("")
  const [loadRetryKey, setLoadRetryKey] =
    useState(0)
  const { user } = useUser()
  const {
    activeWorkspaceId,
    workspaceVersion,
  } =
    useActiveWorkspace(user?.id)
  const savedSourceTypes =
    sourceConnections.map(
      (connection) =>
        connection.source_type
    )
  const configurableSources =
    sources.filter(
      (source) =>
        source.connection_type !== "upload"
    )

  async function loadConnections() {
    if (!user?.id) return

    try {
      const data =
        await getDataSourceConnections(
          user.id,
          activeWorkspaceId
        )

      setSourceConnections(data)
      setConnectionError("")
    } catch (error) {
      setConnectionError(
        getErrorMessage(
          error,
          "Could not load data source connections."
        )
      )
      console.error(error)
    }
  }

  function clearConnectionFeedback(
    connectionId: number
  ) {
    setConnectionFeedback((currentFeedback) => {
      if (!currentFeedback[connectionId]) {
        return currentFeedback
      }

      const nextFeedback = {
        ...currentFeedback,
      }
      delete nextFeedback[connectionId]
      return nextFeedback
    })
  }

  function showConnectionFeedback(
    connectionId: number,
    tone: DataSourceConnectionFeedback["tone"],
    message: string
  ) {
    const displayTone =
      tone === "error" && isNoDataMessage(message)
        ? "no_data"
        : tone
    const token = Date.now()
    setConnectionFeedback((currentFeedback) => ({
      ...currentFeedback,
      [connectionId]: {
        tone: displayTone,
        message,
        token,
      },
    }))
    window.setTimeout(() => {
      setConnectionFeedback((currentFeedback) => {
        if (
          currentFeedback[connectionId]?.token !==
          token
        ) {
          return currentFeedback
        }

        const nextFeedback = {
          ...currentFeedback,
        }
        delete nextFeedback[connectionId]
        return nextFeedback
      })
    }, 6000)
  }

  async function handleCreateSourceConnection(
    source: DatasetSourceOption
  ) {
    if (!user?.id) return

    setCreatingSourceType(source.type)
    setConnectionError("")
    setConnectionNotice("")

    try {
      const connection =
        await createDataSourceConnection(
          {
            source_type: source.type,
            display_name: source.label,
          },
          user.id,
          activeWorkspaceId
        )

      setSourceConnections(
        (currentConnections) => [
          connection,
          ...currentConnections.filter(
            (currentConnection) =>
              currentConnection.id !==
              connection.id
          ),
        ]
      )

      await loadConnections()
    } catch (error) {
      setConnectionError(
        getErrorMessage(
          error,
          "Could not save data source connection."
        )
      )
      console.error(error)
    } finally {
      setCreatingSourceType(null)
    }
  }

  async function handleDeleteSourceConnection(
    connection: DataSourceConnection
  ) {
    if (!user?.id) return

    setDeletingConnectionId(connection.id)
    setConnectionError("")
    setConnectionNotice("")

    try {
      await deleteDataSourceConnection(
        connection.id,
        user.id,
        activeWorkspaceId
      )

      setSourceConnections(
        (currentConnections) =>
          currentConnections.filter(
            (currentConnection) =>
              currentConnection.id !==
              connection.id
          )
      )

      await loadConnections()
    } catch (error) {
      setConnectionError(
        getErrorMessage(
          error,
          "Could not delete data source connection."
        )
      )
      console.error(error)
    } finally {
      setDeletingConnectionId(null)
    }
  }

  async function handleRenameSourceConnection(
    connection: DataSourceConnection,
    displayName: string
  ) {
    await updateConnection(
      connection,
      {
        display_name: displayName,
      },
      "Could not rename data source connection."
    )
  }

  async function handleConfigureSourceConnection(
    connection: DataSourceConnection,
    connectionConfig: Record<string, unknown>
  ) {
    await updateConnection(
      connection,
      {
        connection_config: connectionConfig,
      },
      "Could not configure data source connection."
    )
  }

  async function handleSyncSourceConnection(
    connection: DataSourceConnection,
    payload: DataSourceConnectionSyncPayload
  ) {
    if (!user?.id) return

    setSyncingConnectionId(connection.id)
    setConnectionError("")
    setConnectionNotice("")
    clearConnectionFeedback(connection.id)

    try {
      const result =
        await syncDataSourceConnection(
          connection.id,
          user.id,
          activeWorkspaceId,
          payload
        )

      const isEmptySyncResult =
        result.status === "no_data" ||
        (Array.isArray(result.datasets) &&
          result.datasets.length === 0 &&
          result.dataset_id == null &&
          result.row_count == null)

      if (result.status === "error") {
        showConnectionFeedback(
          connection.id,
          "error",
          result.message ??
            `${connection.source_label} could not be synced right now. Please try again shortly.`
        )
        await loadConnections()
        return
      }

      if (isEmptySyncResult) {
        showConnectionFeedback(
          connection.id,
          "no_data",
          result.message ??
            "No records were found for the selected sync period."
        )
        return
      }

      const syncedDatasets = result.datasets ?? [result]
      showConnectionFeedback(
        connection.id,
        "success",
        syncedDatasets.length > 1
          ? `Synced ${syncedDatasets.length} datasets.`
          : `Synced ${result.file_name} with ${result.row_count} rows.`
      )
      await loadConnections()
    } catch (error) {
      const message = getErrorMessage(
        error,
        `${connection.source_label} could not be synced right now. Please try again shortly.`
      )
      showConnectionFeedback(
        connection.id,
        isNoDataMessage(message)
          ? "no_data"
          : "error",
        getCustomerFacingConnectionError(
          error,
          `${connection.source_label} could not be synced right now. Please try again shortly.`
        )
      )
    } finally {
      setSyncingConnectionId(null)
    }
  }

  async function handleStartOAuthConnection(
    connection: DataSourceConnection
  ) {
    if (!user?.id) return
    const missingConfigKeys =
      getMissingRequiredConnectionConfigKeys(
        connection,
        sources
      )
    if (missingConfigKeys.length > 0) {
      showConnectionFeedback(
        connection.id,
        "error",
        connection.source_type === "google_ads"
          ? "Enter and save the Google Ads customer ID before connecting with OAuth."
          : "Enter and save the required connection settings before connecting with OAuth."
      )
      return
    }

    setOAuthConnectionId(connection.id)
    setConnectionError("")
    setConnectionNotice("")
    try {
      const result = await startOAuthConnection(
        connection.id,
        user.id,
        activeWorkspaceId
      )
      window.location.assign(result.authorization_url)
    } catch (error) {
      showConnectionFeedback(
        connection.id,
        "error",
        getCustomerFacingConnectionError(
          error,
          `${connection.source_label} authorization could not be started right now. Please try again shortly.`
        )
      )
      setOAuthConnectionId(null)
    }
  }

  async function handleCancelOAuthAuthorization(
    connection: DataSourceConnection
  ) {
    if (!user?.id) return

    setUpdatingConnectionId(connection.id)
    setConnectionError("")
    setConnectionNotice("")
    try {
      await cancelOAuthAuthorization(
        connection.id,
        user.id,
        activeWorkspaceId
      )
      setConnectionNotice(
        `Authorization cancelled for ${connection.display_name}.`
      )
      await loadConnections()
    } catch (error) {
      setConnectionError(
        getErrorMessage(
          error,
          "Could not cancel connector authorization."
        )
      )
      console.error(error)
    } finally {
      setUpdatingConnectionId(null)
    }
  }

  async function handleUpdateConnectionSchedule(
    connection: DataSourceConnection,
    enabled: boolean,
    intervalHours: number,
    timeOfDay: string,
    timezone: string,
    dayOfWeek: number
  ) {
    if (!user?.id) return
    setUpdatingConnectionId(connection.id)
    setConnectionError("")
    try {
      const updatedConnection =
        await updateDataSourceConnectionSchedule(
          connection.id,
          {
            enabled,
            interval_hours: intervalHours,
            time_of_day: timeOfDay,
            timezone,
            day_of_week: dayOfWeek,
          },
          user.id,
          activeWorkspaceId
        )
      setSourceConnections((currentConnections) =>
        currentConnections.map((currentConnection) =>
          currentConnection.id === updatedConnection.id
            ? updatedConnection
            : currentConnection
        )
      )
    } catch (error) {
      setConnectionError(
        getErrorMessage(
          error,
          "Could not update connector schedule."
        )
      )
      console.error(error)
    } finally {
      setUpdatingConnectionId(null)
    }
  }

  async function updateConnection(
    connection: DataSourceConnection,
    payload: Parameters<typeof updateDataSourceConnection>[1],
    fallbackMessage: string
  ) {
    if (!user?.id) return

    setUpdatingConnectionId(connection.id)
    setConnectionError("")

    try {
      const updatedConnection =
        await updateDataSourceConnection(
          connection.id,
          payload,
          user.id,
          activeWorkspaceId
        )

      setSourceConnections(
        (currentConnections) =>
          currentConnections.map(
            (currentConnection) =>
              currentConnection.id ===
              updatedConnection.id
                ? updatedConnection
                : currentConnection
          )
      )

      await loadConnections()
    } catch (error) {
      setConnectionError(
        getErrorMessage(
          error,
          fallbackMessage
        )
      )
      console.error(error)
    } finally {
      setUpdatingConnectionId(null)
    }
  }

  useEffect(() => {
    if (
      !user?.id ||
      !canViewConnections
    ) {
      return
    }

    let ignoreResult = false

    async function loadInitialConnections(
      userId: string
    ) {
      setSources([])
      setSourceConnections([])
      setConnectionError("")
      setConnectionLoadError("")

      const [
        sourcesResult,
        connectionsResult,
      ] = await Promise.allSettled([
        getDatasetSources(
          userId,
          activeWorkspaceId
        ),
        getDataSourceConnections(
          userId,
          activeWorkspaceId
        ),
      ])

      if (ignoreResult) {
        return
      }

      if (sourcesResult.status === "fulfilled") {
        setSources(sourcesResult.value)
      } else {
        const message = getErrorMessage(
          sourcesResult.reason,
          "Could not load data source options."
        )
        setConnectionError(message)
        setConnectionLoadError(message)
        console.error(sourcesResult.reason)
      }

      if (connectionsResult.status === "fulfilled") {
        setSourceConnections(
          connectionsResult.value
        )
      } else {
        const message = getErrorMessage(
          connectionsResult.reason,
          "Could not load data source connections."
        )
        setConnectionError(message)
        setConnectionLoadError(message)
        console.error(connectionsResult.reason)
      }

      if (
        sourcesResult.status === "fulfilled" &&
        connectionsResult.status === "fulfilled"
      ) {
        setConnectionError("")
        setConnectionLoadError("")
      }
    }

    void loadInitialConnections(user.id)

    return () => {
      ignoreResult = true
    }
  }, [
    user?.id,
    activeWorkspaceId,
    canConfigureWorkspace,
    canViewConnections,
    workspaceVersion,
    loadRetryKey,
  ])

  return (
    <div className="space-y-8">
      <DashboardPageHeader
        title="Connections"
        description="Configure external business systems that can feed datasets, forecasts, reports, alerts, and decisions."
      />

      {canViewConnections && connectionError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <span>{connectionError}</span>

          {connectionLoadError && (
            <button
              type="button"
              onClick={() =>
                setLoadRetryKey((currentKey) =>
                  currentKey + 1
                )
              }
              className="h-10 shrink-0 rounded-xl border border-red-200 bg-white px-3 font-medium text-red-700 transition hover:border-red-300"
            >
              Try again
            </button>
          )}
        </div>
      )}

      {canConfigureWorkspace && connectionNotice && (
        <div
          role="status"
          className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700"
        >
          {connectionNotice}
        </div>
      )}

      {!loadingWorkspaceAccess &&
        canConfigureWorkspace && (
        <div className="rounded-2xl border bg-white p-5 shadow-sm sm:p-8">
          <h2 className="mb-4 text-xl font-semibold">
            Data Sources
          </h2>

          <p className="mb-6 text-sm text-gray-500">
            Add an external connector, then configure its account details and authorize it before syncing data into a dataset. File uploads are available from Datasets.
          </p>

          <DataSourcePanel
            sources={configurableSources}
            savedSourceTypes={
              savedSourceTypes
            }
            creatingSourceType={
              creatingSourceType
            }
            onCreateConnection={
              handleCreateSourceConnection
            }
          />
        </div>
      )}

      {loadingWorkspaceAccess ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500"
        >
          Checking workspace access...
        </div>
      ) : !canViewConnections ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          Connection access is not available to workspace members.
        </div>
      ) : (
        <div className="rounded-2xl border bg-white p-5 shadow-sm sm:p-8">
          <h2 className="text-xl font-semibold">
            {canConfigureWorkspace
              ? "Configure Added Connections"
              : "Available Connections"}
          </h2>

          <p className="mb-4 mt-2 text-sm text-gray-500">
            {canConfigureWorkspace
              ? "Finish setup for added connectors by providing the account, query, or authorization details needed for dataset pulls."
              : "Review the external data source connections available to this workspace. Configuration and synchronization are managed by the business owner."}
          </p>

          <DataSourceConnections
            connections={
              sourceConnections
            }
            loadError={Boolean(connectionLoadError)}
            sources={configurableSources}
            deletingConnectionId={
              deletingConnectionId
            }
            updatingConnectionId={
              updatingConnectionId
            }
            syncingConnectionId={
              syncingConnectionId
            }
            connectionFeedback={connectionFeedback}
            onDeleteConnection={
              canConfigureWorkspace
                ? handleDeleteSourceConnection
                : undefined
            }
            onRenameConnection={
              canConfigureWorkspace
                ? handleRenameSourceConnection
                : undefined
            }
            onConfigureConnection={
              canConfigureWorkspace
                ? handleConfigureSourceConnection
                : undefined
            }
            onSyncConnection={
              canConfigureWorkspace
                ? handleSyncSourceConnection
                : undefined
            }
            onStartOAuthConnection={
              canConfigureWorkspace
                ? handleStartOAuthConnection
                : undefined
            }
            onCancelOAuthAuthorization={
              canConfigureWorkspace
                ? handleCancelOAuthAuthorization
                : undefined
            }
            onUpdateSchedule={
              canConfigureWorkspace
                ? handleUpdateConnectionSchedule
                : undefined
            }
          />
        </div>
      )}
    </div>
  )
}
