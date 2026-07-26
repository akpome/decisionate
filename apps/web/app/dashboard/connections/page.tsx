"use client"

import { useEffect, useState } from "react"
import { useUser } from "@clerk/nextjs"

import { DataSourceConnections } from "@/features/datasets/components/data-source-connections"
import { DataSourcePanel } from "@/features/datasets/components/data-source-panel"
import { DashboardPageHeader } from "@/features/dashboard/components/dashboard-page-header"
import {
  createDataSourceConnection,
  deleteDataSourceConnection,
  getDataSourceConnections,
  getDatasetSources,
  updateDataSourceConnection,
  type DataSourceConnection,
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

export default function ConnectionsPage() {
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
  const [connectionError, setConnectionError] =
    useState("")
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
  const {
    canManageWorkspaceData,
    isClientWorkspace,
    loadingWorkspaceAccess,
    workspaceRole,
  } =
    useWorkspaceAccess(user?.id)
  const readOnlyWorkspace =
    isClientWorkspace ||
    workspaceRole === "unknown"
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

  async function handleCreateSourceConnection(
    source: DatasetSourceOption
  ) {
    if (!user?.id) return

    setCreatingSourceType(source.type)
    setConnectionError("")

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
      !canManageWorkspaceData
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
    canManageWorkspaceData,
    workspaceVersion,
    loadRetryKey,
  ])

  return (
    <div className="space-y-8">
      <DashboardPageHeader
        title="Connections"
        description="Configure external business systems that can feed datasets, forecasts, reports, alerts, and decisions."
      />

      {canManageWorkspaceData && connectionError && (
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

      {!loadingWorkspaceAccess &&
        canManageWorkspaceData && (
        <div className="rounded-2xl border bg-white p-5 shadow-sm sm:p-8">
          <h2 className="mb-4 text-xl font-semibold">
            Data Sources
          </h2>

          <p className="mb-6 text-sm text-gray-500">
            Choose applications and databases that need setup. CSV, Excel, JSON and Parquet uploads are available from Datasets.
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
      ) : readOnlyWorkspace ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          {isClientWorkspace
            ? "Data source connections are managed by the workspace team. Use the shared datasets and analysis pages to review available results."
            : "Workspace access could not be confirmed. Connection management is temporarily unavailable."}
        </div>
      ) : (
        <div className="rounded-2xl border bg-white p-5 shadow-sm sm:p-8">
          <h2 className="text-xl font-semibold">
            Configure Added Connections
          </h2>

          <p className="mb-4 mt-2 text-sm text-gray-500">
            Finish setup for data sources added to this workspace by providing the account, query, or credential details needed for dataset pulls.
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
            onDeleteConnection={
              canManageWorkspaceData
                ? handleDeleteSourceConnection
                : undefined
            }
            onRenameConnection={
              canManageWorkspaceData
                ? handleRenameSourceConnection
                : undefined
            }
            onConfigureConnection={
              canManageWorkspaceData
                ? handleConfigureSourceConnection
                : undefined
            }
          />
        </div>
      )}
    </div>
  )
}
