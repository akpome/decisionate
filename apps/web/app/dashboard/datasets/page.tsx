"use client"

import { useEffect, useState } from "react"
import { useUser } from "@clerk/nextjs"

import { ConnectionPullWidget } from "@/features/datasets/components/connection-pull-widget"
import { CsvUpload } from "@/features/datasets/components/csv-upload"
import { SignedUrlImport } from "@/features/datasets/components/signed-url-import"
import { DatasetList } from "@/features/datasets/components/dataset-list"
import { DashboardPageHeader } from "@/features/dashboard/components/dashboard-page-header"
import {
  getDataSourceConnections,
  getDatasetSources,
  getDatasets,
  type DataSourceConnection,
  type DatasetSourceOption,
  type DatasetSummary,
} from "@/lib/api"
import {
  useActiveWorkspace,
} from "@/lib/use-active-workspace"
import {
  useWorkspaceAccess,
} from "@/lib/use-workspace-access"
import {
  WorkspaceAccessNotice,
} from "@/features/dashboard/components/workspace-access-notice"

function getErrorMessage(
  error: unknown,
  fallback: string
) {
  return error instanceof Error &&
    error.message
    ? error.message
    : fallback
}

export default function DatasetsPage() {
  const [datasets, setDatasets] =
    useState<DatasetSummary[]>([])
  const [sources, setSources] =
    useState<DatasetSourceOption[]>([])
  const [connections, setConnections] =
    useState<DataSourceConnection[]>([])
  const [datasetError, setDatasetError] =
    useState("")
  const [loadingDatasets, setLoadingDatasets] =
    useState(true)
  const [sourceError, setSourceError] =
    useState("")
  const [connectionError, setConnectionError] =
    useState("")
  const [initialDataRetryKey, setInitialDataRetryKey] =
    useState(0)

  const { user } = useUser()
  const {
    activeWorkspaceId,
    workspaceVersion,
  } =
    useActiveWorkspace(user?.id)
  const {
    canConfigureWorkspace,
    canViewConnections,
    loadingWorkspaceAccess,
  } =
    useWorkspaceAccess(user?.id)

  async function loadDatasets() {
    if (!user?.id) return

    setLoadingDatasets(true)

    try {
      const data =
        await getDatasets(
          user.id,
          activeWorkspaceId
        )

      setDatasets(data)
      setDatasetError("")
    } catch (error) {
      setDatasetError(
        getErrorMessage(
          error,
          "Could not load datasets."
        )
      )
    } finally {
      setLoadingDatasets(false)
    }
  }

  useEffect(() => {
    if (!user?.id) return

    let ignoreResult = false

    async function loadInitialData(
      userId: string
    ) {
      setDatasets([])
      setDatasetError("")
      setLoadingDatasets(true)

      const [datasetsResult] =
        await Promise.allSettled([
          getDatasets(
            userId,
            activeWorkspaceId
          ),
        ])

      if (ignoreResult) {
        return
      }

      if (datasetsResult.status === "fulfilled") {
        setDatasets(datasetsResult.value)
        setDatasetError("")
      } else {
        setDatasetError(
          getErrorMessage(
            datasetsResult.reason,
            "Could not load datasets."
          )
        )
      }

      setLoadingDatasets(false)

    }

    void loadInitialData(user.id)

    return () => {
      ignoreResult = true
    }
  }, [
    user?.id,
    activeWorkspaceId,
    initialDataRetryKey,
    workspaceVersion,
  ])

  useEffect(() => {
    if (
      !user?.id ||
      !canViewConnections
    ) {
      return
    }

    let ignoreResult = false

    async function loadSourceData(
      userId: string
    ) {
      setSources([])
      setConnections([])
      setSourceError("")
      setConnectionError("")

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
        setSourceError("")
      } else {
        setSourceError(
          getErrorMessage(
            sourcesResult.reason,
            "Could not load upload source options."
          )
        )
      }

      if (
        connectionsResult.status === "fulfilled"
      ) {
        setConnections(connectionsResult.value)
        setConnectionError("")
      } else {
        setConnectionError(
          getErrorMessage(
            connectionsResult.reason,
            "Could not load saved connections."
          )
        )
      }
    }

    void loadSourceData(user.id)

    return () => {
      ignoreResult = true
    }
  }, [
    activeWorkspaceId,
    canConfigureWorkspace,
    canViewConnections,
    initialDataRetryKey,
    user?.id,
    workspaceVersion,
  ])

  return (
    <div className="space-y-8">
      <DashboardPageHeader
        title="Datasets"
        description={
          loadingWorkspaceAccess
            ? "Loading workspace data access..."
            : canConfigureWorkspace
              ? "Upload and manage datasets used for dashboards, insights, forecasts, and decisions."
              : "Review datasets shared by the workspace team for dashboards, insights, forecasts, and decisions."
        }
      />

      <WorkspaceAccessNotice
        loading={loadingWorkspaceAccess}
        canManageWorkspaceData={canConfigureWorkspace}
        message="This shared workspace is read-only. The business owner handles dataset uploads, connections, and changes."
        className="rounded-xl"
      />

      {sourceError && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {sourceError}
        </div>
      )}

      {datasetError && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {datasetError}
        </div>
      )}

      {connectionError && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {connectionError}
        </div>
      )}

      {(sourceError || datasetError || connectionError) && (
        <button
          type="button"
          onClick={() =>
            setInitialDataRetryKey(
              currentKey => currentKey + 1
            )
          }
          className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          Retry data services
        </button>
      )}

      {canConfigureWorkspace && (
        <>
          <div className="rounded-2xl border bg-white p-5 shadow-sm sm:p-8">
            <p className="mb-6 text-sm text-gray-500">
              Upload CSV, Excel, JSON or Parquet files directly into the workspace.
            </p>

            <CsvUpload
              sources={sources}
              onUploadSuccess={
                loadDatasets
              }
            />
            <SignedUrlImport
              onImportSuccess={loadDatasets}
            />
          </div>
        </>
      )}

      {canViewConnections && (
        <ConnectionPullWidget
          connections={connections}
          loadError={Boolean(connectionError)}
        />
      )}

      <div className="rounded-2xl border bg-white p-5 shadow-sm sm:p-8">
        <h2 className="mb-4 text-xl font-semibold">
          Saved Datasets
        </h2>

        {loadingDatasets ? (
          <div
            role="status"
            className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500"
          >
            Loading datasets...
          </div>
        ) : (
          <DatasetList
            datasets={datasets}
            canDelete={canConfigureWorkspace}
            canManage={canConfigureWorkspace}
            loadError={Boolean(datasetError)}
            onRefresh={
              loadDatasets
            }
          />
        )}
      </div>
    </div>
  )
}
