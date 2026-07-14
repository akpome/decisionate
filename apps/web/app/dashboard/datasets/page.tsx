"use client"

import { useEffect, useState } from "react"
import { useUser } from "@clerk/nextjs"

import { ConnectionPullWidget } from "@/features/datasets/components/connection-pull-widget"
import { CsvUpload } from "@/features/datasets/components/csv-upload"
import { DatasetList } from "@/features/datasets/components/dataset-list"
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
  const [sourceError, setSourceError] =
    useState("")
  const [connectionError, setConnectionError] =
    useState("")

  const { user } = useUser()
  const {
    activeWorkspaceId,
    workspaceVersion,
  } =
    useActiveWorkspace(user?.id)
  const {
    canManageWorkspaceData,
    isClientWorkspace,
  } =
    useWorkspaceAccess(user?.id)

  async function loadDatasets() {
    if (!user?.id) return

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
      console.error(error)
    }
  }

  useEffect(() => {
    if (!user?.id) return

    let ignoreResult = false

    async function loadInitialData(
      userId: string
    ) {
      const [
        datasetsResult,
        sourcesResult,
        connectionsResult,
      ] = await Promise.allSettled([
        getDatasets(
          userId,
          activeWorkspaceId
        ),
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
        console.error(datasetsResult.reason)
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
        console.error(sourcesResult.reason)
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
        console.error(connectionsResult.reason)
      }
    }

    void loadInitialData(user.id)

    return () => {
      ignoreResult = true
    }
  }, [
    user?.id,
    activeWorkspaceId,
    workspaceVersion,
  ])

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">
          Datasets
        </h1>

        <p className="mt-2 text-gray-500">
          Upload and manage datasets used for dashboards, insights, forecasts and decisions.
        </p>
      </div>

      {sourceError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {sourceError}
        </div>
      )}

      {datasetError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {datasetError}
        </div>
      )}

      {connectionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {connectionError}
        </div>
      )}

      {isClientWorkspace && (
        <div className="rounded-2xl border border-blue-100 bg-blue-50 p-6 text-sm text-blue-800">
          You are viewing a client portal workspace. Your agency manages uploads, source pulls, and dataset setup for this workspace.
        </div>
      )}

      {canManageWorkspaceData && (
        <>
          <div className="rounded-2xl border bg-white p-8 shadow-sm">
            <h2 className="mb-4 text-xl font-semibold">
              Upload Data File
            </h2>

            <p className="mb-6 text-sm text-gray-500">
              Upload CSV, Excel, JSON or Parquet files directly into the workspace.
            </p>

            <CsvUpload
              sources={sources}
              onUploadSuccess={
                loadDatasets
              }
            />
          </div>

          <ConnectionPullWidget
            connections={connections}
          />
        </>
      )}

      <div className="rounded-2xl border bg-white p-8 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold">
          Saved Datasets
        </h2>

        <DatasetList
          datasets={datasets}
          canDelete={canManageWorkspaceData}
          onRefresh={
            loadDatasets
          }
        />
      </div>
    </div>
  )
}
