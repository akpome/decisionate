"use client"

import {
    useState,
} from "react"
import {
    deleteDataset,
} from "@/lib/api"
import Link from "next/link"
import {
    Database,
    ExternalLink,
    FileText,
    Table2,
    Trash2,
} from "lucide-react"
import { useUser } from "@clerk/nextjs"
import {
    useActiveWorkspace,
} from "@/lib/use-active-workspace"
import {
    formatSourceValue,
    getDatasetSourceDetails,
} from "@/features/datasets/lib/source-config"

interface DatasetListProps {
  datasets: Dataset[]
  onRefresh: () => Promise<void>
  canDelete?: boolean
  canManage?: boolean
  loadError?: boolean
}

interface Dataset {
    id: number
    file_name: string
    row_count: number
    column_count: number
    created_at?: string
    source_type?: string | null
    source_label?: string | null
    source_config?: string | null
}

export function DatasetList({
    datasets,
    onRefresh,
    canDelete = true,
    canManage = true,
    loadError = false,
}: DatasetListProps) {

    const { user } = useUser()
    const { activeWorkspaceId } =
        useActiveWorkspace(user?.id)
    const [
        errorMessage,
        setErrorMessage,
    ] = useState("")
    const [
        deletingDatasetId,
        setDeletingDatasetId,
    ] = useState<number | null>(null)

    async function handleDelete(
        datasetId: number
    ) {
        if (!user?.id) {
            setErrorMessage(
                "Sign in before deleting a dataset."
            )
            return
        }

        const confirmed =
            window.confirm(
                "Delete this dataset?"
            )

        if (!confirmed) return

        setDeletingDatasetId(datasetId)
        setErrorMessage("")

        try {
            await deleteDataset(
                datasetId,
                user.id,
                activeWorkspaceId
            )

            await onRefresh()

        } catch (error) {
            setErrorMessage(
                error instanceof Error &&
                    error.message
                    ? error.message
                    : "Failed to delete dataset"
            )
            console.error(
                "Failed to delete dataset",
                error
            )
        } finally {
            setDeletingDatasetId(null)
        }
    }

    if (!datasets.length) {
        return (
            <div className={`rounded-lg border border-dashed p-6 text-sm ${loadError ? "border-red-200 bg-red-50 text-red-700" : "bg-gray-50 text-gray-500"}`}>
                {loadError
                    ? "The saved dataset list is unavailable. Retry the data services above."
                    : canManage
                        ? "No saved datasets yet. Upload a file above or pull from a configured connection so dashboards, forecasts, reports, alerts, and decisions can use real metrics."
                        : "No datasets have been shared with this workspace yet. Ask the workspace team to share one so dashboards, forecasts, reports, alerts, and decisions can use real metrics."}
            </div>
        )
    }

    const totalRows =
        datasets.reduce(
            (total, dataset) =>
                total + dataset.row_count,
            0
        )
    const totalColumns =
        datasets.reduce(
            (total, dataset) =>
                total + dataset.column_count,
            0
        )
    const sourceCount =
        new Set(
            datasets.map(
                (dataset) =>
                    getDatasetSourceDetails(
                        dataset.source_type,
                        dataset.source_config,
                        dataset.source_label
                    ).formattedFormat
            )
        ).size

    return (
        <div className="space-y-4">
            {errorMessage && (
                <div
                    role="alert"
                    className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                >
                    {errorMessage}
                </div>
            )}

            <div className="grid gap-3 md:grid-cols-3">
                <DatasetStat
                    icon={Database}
                    label="Datasets"
                    value={datasets.length}
                />
                <DatasetStat
                    icon={Table2}
                    label="Rows"
                    value={totalRows}
                />
                <DatasetStat
                    icon={FileText}
                    label="Columns"
                    value={totalColumns}
                    detail={`${sourceCount} source ${sourceCount === 1 ? "type" : "types"}`}
                />
            </div>

            <div className="divide-y rounded-lg border">
                {datasets.map((dataset) => (
                    <DatasetListItem
                        key={dataset.id}
                        dataset={dataset}
                        deletingDatasetId={
                            deletingDatasetId
                        }
                        canDelete={canDelete}
                        onDelete={handleDelete}
                    />
                ))}
            </div>
        </div>
    )
}

function DatasetStat({
    icon: Icon,
    label,
    value,
    detail,
}: {
    icon: typeof Database
    label: string
    value: number
    detail?: string
}) {
    return (
        <div className="rounded-lg border bg-gray-50 p-4">
            <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-gray-700">
                    <Icon size={18} />
                </div>

                <div>
                    <p className="text-2xl font-semibold">
                        {value.toLocaleString()}
                    </p>

                    <p className="text-xs font-medium uppercase text-gray-500">
                        {label}
                    </p>
                </div>
            </div>

            {detail && (
                <p className="mt-3 text-xs text-gray-500">
                    {detail}
                </p>
            )}
        </div>
    )
}

function DatasetListItem({
    dataset,
    deletingDatasetId,
    canDelete,
    onDelete,
}: {
    dataset: Dataset
    deletingDatasetId: number | null
    canDelete: boolean
    onDelete: (datasetId: number) => void
}) {
    const sourceDetails =
        getDatasetSourceDetails(
            dataset.source_type,
            dataset.source_config,
            dataset.source_label
        )
    const createdAt =
        formatDatasetDate(
            dataset.created_at
        )

    return (
        <div className="flex flex-col gap-4 bg-white p-4 first:rounded-t-lg last:rounded-b-lg md:flex-row md:items-center md:justify-between">
            <Link
                href={`/dashboard/datasets/${dataset.id}`}
                className="min-w-0 flex-1"
            >
                <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-700">
                        <FileText size={18} />
                    </div>

                    <div className="min-w-0">
                        <div className="truncate font-medium">
                            {dataset.file_name}
                        </div>

                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-500">
                            <span>
                                {dataset.row_count.toLocaleString()} rows
                            </span>
                            <span>
                                {dataset.column_count.toLocaleString()} columns
                            </span>
                            {createdAt && (
                                <span>
                                    Added {createdAt}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                <div className="mt-3 flex min-w-0 flex-wrap gap-2">
                    <span className="rounded-full bg-[var(--decisionate-brand-primary-soft)] px-2.5 py-1 text-xs font-medium text-[var(--decisionate-brand-primary-text)]">
                        {sourceDetails.label}
                    </span>
                    {sourceDetails.storedFileFormat && (
                        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
                            Stored as {formatSourceValue(sourceDetails.storedFileFormat)}
                        </span>
                    )}

                </div>

                {sourceDetails.originalFileName && (
                    <div className="mt-2 break-all text-xs text-gray-400">
                        Original file:{" "}
                        {sourceDetails.originalFileName}
                    </div>
                )}

            </Link>

            <div className="flex shrink-0 flex-col gap-2 sm:flex-row md:justify-end">
                <Link
                    href={`/dashboard/datasets/${dataset.id}`}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 sm:w-auto"
                >
                    <ExternalLink size={15} />
                    View
                </Link>

                {canDelete && (
                    <button
                        type="button"
                        onClick={() =>
                            onDelete(
                                dataset.id
                            )
                        }
                        disabled={
                            deletingDatasetId ===
                            dataset.id
                        }
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                        title="Delete dataset"
                    >
                        <Trash2 size={15} />
                        {deletingDatasetId ===
                        dataset.id
                            ? "Deleting"
                            : "Delete"}
                    </button>
                )}
            </div>
        </div>
    )
}

function formatDatasetDate(
    value?: string
) {
    if (!value) {
        return null
    }

    const date = new Date(value)

    if (Number.isNaN(date.getTime())) {
        return null
    }

    return date.toLocaleDateString(
        undefined,
        {
            month: "short",
            day: "numeric",
            year: "numeric",
        }
    )
}
