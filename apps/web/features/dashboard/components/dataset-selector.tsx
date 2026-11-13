"use client"

import { useEffect, useState, type ReactNode } from "react"
import {
  useAuth,
  useUser,
} from "@clerk/nextjs"
import Link from "next/link"
import { RefreshCw } from "lucide-react"
import { SearchableSelect } from "@/components/searchable-select"

import {
  type DatasetSummary,
  getDatasets,
} from "@/lib/api"
import {
  useActiveWorkspace,
} from "@/lib/use-active-workspace"
import {
  getDatasetSourceDetails,
} from "@/features/datasets/lib/source-config"
import { useDecisionateText } from "@/app/use-decisionate-language"
interface DatasetSelectorProps {
  value?: number
  onChange: (id: number | undefined) => void
  datasets?: DatasetSummary[]
  loading?: boolean
  loadError?: boolean
  allowClear?: boolean
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
  allowClear = true,
  ariaLabel = "Select dataset",
  emptyMessage,
}: DatasetSelectorProps) {
  const { t } = useDecisionateText()
  const {
    isLoaded: authLoaded,
    isSignedIn,
    userId,
  } = useAuth()
  const { user } = useUser()
  const resolvedUserId =
    userId ??
    user?.id
  const {
    activeWorkspaceId,
    workspaceVersion,
  } =
    useActiveWorkspace(resolvedUserId ?? undefined)

  const [loadedDatasets, setLoadedDatasets] =
    useState<DatasetSummary[]>([])
  const [errorMessage, setErrorMessage] =
    useState("")
  const [retry, setRetry] = useState(0)
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
        <Link
          href="/dashboard/datasets"
          className="font-medium text-[var(--decisionate-brand-primary-text)] hover:opacity-80"
        >
          {t("Add a dataset")}
        </Link>
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
    retry,
  ])

  return (
    <div className="w-full min-w-0 max-w-full space-y-2">
      <SearchableSelect
        label={t(ariaLabel)} hideLabel
        value={value === undefined ? null : String(value)} selectedLabel={selectedDatasetLabel}
        disabled={isLoading && !hasDatasets}
        loading={isLoading} loadingLabel={t("Loading datasets...")}
        onChange={selected => onChange(getSelectedDatasetId(selected))}
        placeholder={!authLoaded
            ? t("Checking session...")
            : !hasAuthenticatedUser
              ? t("Sign in to load datasets")
              : isLoading
            ? t("Loading datasets...")
            : errorMessage || loadError
              ? t("Datasets unavailable")
            : hasDatasets
              ? t("Choose or search datasets")
              : t("No datasets available")}
        emptyLabel={t("No matching datasets.")}
        options={[
          ...(allowClear && value !== undefined ? [{ value: "", label: t("Clear dataset selection") }] : []),
          ...datasets.map(dataset => ({ value: String(dataset.id), label: formatDatasetOptionLabel(dataset) })),
        ]}
      />

      {errorMessage && (
        <p
          role="alert"
          className="text-sm text-red-700"
        >
          {errorMessage}
          {hasAuthenticatedUser && !providedDatasets && <button type="button" disabled={isLoading}
            onClick={() => setRetry(current => current + 1)}
            className="ml-3 inline-flex items-center gap-1 font-medium disabled:opacity-50">
            <RefreshCw size={14} />{t("Retry datasets")}
          </button>}
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
