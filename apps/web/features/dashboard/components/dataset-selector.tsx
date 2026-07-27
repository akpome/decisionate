"use client"

import { useEffect, useState, type ReactNode } from "react"
import {
  useAuth,
  useUser,
} from "@clerk/nextjs"
import Link from "next/link"

import {
  type DatasetSummary,
  getDatasets,
} from "@/lib/api"
import {
  useActiveWorkspace,
} from "@/lib/use-active-workspace"
import {
  useDashboardSessionUserId,
} from "@/lib/dashboard-session-context"
import {
  getDatasetSourceDetails,
} from "@/features/datasets/lib/source-config"
interface DatasetSelectorProps {
  value?: number
  onChange: (id: number | undefined) => void
  datasets?: DatasetSummary[]
  loading?: boolean
  loadError?: boolean
  ariaLabel?: string
  emptyMessage?: ReactNode
}

function getSelectedDatasetId(
  value: string
) {
  if (!value) {
    return undefined
  }

  const datasetId = Number(value)

  return Number.isInteger(datasetId) &&
    datasetId > 0
    ? datasetId
    : undefined
}

export function DatasetSelector({
  value,
  onChange,
  datasets: providedDatasets,
  loading = false,
  loadError = false,
  ariaLabel = "Select dataset",
  emptyMessage,
}: DatasetSelectorProps) {
  const {
    isLoaded: authLoaded,
    isSignedIn,
    userId,
  } = useAuth()
  const { user } = useUser()
  const serverUserId =
    useDashboardSessionUserId()
  const resolvedUserId =
    userId ??
    user?.id ??
    serverUserId
  const {
    activeWorkspaceId,
    workspaceVersion,
  } =
    useActiveWorkspace(resolvedUserId ?? undefined)

  const [loadedDatasets, setLoadedDatasets] =
    useState<DatasetSummary[]>([])
  const [errorMessage, setErrorMessage] =
    useState("")
  const [
    loadingDatasets,
    setLoadingDatasets,
  ] = useState(false)
  const datasets =
    providedDatasets ??
    loadedDatasets
  const hasAuthenticatedUser =
    authLoaded &&
    Boolean(isSignedIn && resolvedUserId)
  const isLoading =
    !authLoaded ||
    (hasAuthenticatedUser &&
      (loading || loadingDatasets))
  const hasDatasets =
    datasets.length > 0
  const selectedDataset =
    datasets.find(
      (dataset) =>
        dataset.id === value
    )
  const selectedDatasetLabel =
    selectedDataset
      ? formatDatasetOptionLabel(
          selectedDataset
        )
      : undefined
  const emptyStateMessage =
    emptyMessage ?? (
      <>
        Upload a supported CSV, Excel, JSON, or Parquet file on{" "}
        <Link
          href="/dashboard/datasets"
          className="font-medium text-[var(--decisionate-brand-primary-text)] hover:opacity-80"
        >
          Datasets
        </Link>{" "}
        to start building dashboards, forecasts, reports, and decisions.
      </>
    )

  useEffect(() => {
    if (providedDatasets) {
      return
    }

    if (!authLoaded) {
      return
    }

    if (!isSignedIn || !resolvedUserId) {
      queueMicrotask(() => {
        setLoadingDatasets(false)
        setErrorMessage(
          "Sign in to load datasets."
        )
      })
      return
    }

    const currentUserId = resolvedUserId
    let cancelled = false

    async function loadDatasets() {
      try {
        setLoadingDatasets(true)
        setLoadedDatasets([])
        const data =
          await getDatasets(
            currentUserId,
            activeWorkspaceId
          )

        if (cancelled) {
          return
        }

        setLoadedDatasets(data)
        setErrorMessage("")
      } catch (error) {
        if (cancelled) {
          return
        }

        setErrorMessage(
          error instanceof Error &&
            error.message
            ? error.message
            : "Failed to load datasets"
        )
        console.error(error)
      } finally {
        if (!cancelled) {
          setLoadingDatasets(false)
        }
      }
    }

    void loadDatasets()

    return () => {
      cancelled = true
    }
  }, [
    activeWorkspaceId,
    providedDatasets,
    authLoaded,
    isSignedIn,
    resolvedUserId,
    workspaceVersion,
  ])

  return (
    <div className="w-full max-w-full space-y-2">
      <select
        aria-label={ariaLabel}
        value={value ?? ""}
        title={selectedDatasetLabel}
        disabled={
          isLoading && !hasDatasets
        }
        onChange={(e) => {
          const datasetId =
            getSelectedDatasetId(
              e.target.value
            )

          onChange(datasetId)
        }}
        className="block h-11 w-full max-w-full truncate rounded-xl border px-3 py-2 pr-9 text-sm disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
      >
        <option value="">
          {!authLoaded
            ? "Checking session..."
            : !hasAuthenticatedUser
              ? "Sign in to load datasets"
              : isLoading
            ? "Loading datasets..."
            : errorMessage || loadError
              ? "Datasets unavailable"
            : hasDatasets
              ? "Select Dataset"
              : "No datasets available"}
        </option>

        {datasets.map((dataset) => (
          <option
            key={dataset.id}
            value={dataset.id}
          >
            {formatDatasetOptionLabel(
              dataset
            )}
          </option>
        ))}
      </select>

      {errorMessage && (
        <p
          role="alert"
          className="text-sm text-red-700"
        >
          {errorMessage}
        </p>
      )}

      {!errorMessage && !loadError && !isLoading && !hasDatasets && (
        <p className="text-sm text-gray-500">
          {emptyStateMessage}
        </p>
      )}
    </div>
  )
}

function formatDatasetOptionLabel(
  dataset: DatasetSummary
) {
  const sourceDetails =
    getDatasetSourceDetails(
      dataset.source_type,
      dataset.source_config,
      dataset.source_label
    )

  return `${dataset.file_name} (${sourceDetails.label})`
}
