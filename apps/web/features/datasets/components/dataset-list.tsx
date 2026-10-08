"use client"

import {
    useMemo,
    useState,
} from "react"
import {
    deleteDataset,
} from "@/lib/api"
import Link from "next/link"
import {
    Database,
    ArrowRight,
    ChevronLeft,
    ChevronRight,
    FileText,
    LoaderCircle,
    Search,
    Table2,
    Trash2,
    X,
} from "lucide-react"
import { useUser } from "@clerk/nextjs"
import {
    useActiveWorkspace,
} from "@/lib/use-active-workspace"
import {
    getDatasetSourceDetails,
} from "@/features/datasets/lib/source-config"
import { useDecisionateText } from "@/app/use-decisionate-language"

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

    const { t } = useDecisionateText()

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
    const [query, setQuery] = useState("")
    const [source, setSource] = useState("")
    const [sort, setSort] = useState("newest")
    const [page, setPage] = useState(1)
    const entries = useMemo(() => datasets.map(dataset => ({
        dataset,
        source: getDatasetSourceDetails(dataset.source_type, dataset.source_config, dataset.source_label),
    })), [datasets])
    const sourceLabels = [...new Set(entries.map(entry => entry.source.label))].sort()
    const filteredDatasets = useMemo(() => {
        const search = query.trim().toLocaleLowerCase()
        return entries.filter(entry =>
            (!source || entry.source.label === source) &&
            (!search || [entry.dataset.file_name, entry.source.label, entry.source.originalFileName]
                .some(value => value?.toLocaleLowerCase().includes(search)))
        ).map(entry => entry.dataset).sort((left, right) => {
            if (sort === "name") return left.file_name.localeCompare(right.file_name)
            if (sort === "rows") return right.row_count - left.row_count
            const order = (Date.parse(right.created_at ?? "") || 0) - (Date.parse(left.created_at ?? "") || 0) || right.id - left.id
            return sort === "oldest" ? -order : order
        })
    }, [entries, query, source, sort])
    const pageSize = 20
    const pageCount = Math.max(1, Math.ceil(filteredDatasets.length / pageSize))
    const currentPage = Math.min(page, pageCount)
    const start = (currentPage - 1) * pageSize

    function resetFilters() {
        setQuery("")
        setSource("")
        setPage(1)
    }

    async function handleDelete(
        datasetId: number
    ) {
        if (!canDelete || deletingDatasetId !== null) return
        if (!user?.id) {
            setErrorMessage(
                t("Sign in before deleting a dataset.")
            )
            return
        }

        const confirmed =
            window.confirm(
                `${t("Delete dataset")}: ${datasets.find(dataset => dataset.id === datasetId)?.file_name ?? datasetId}?\n${t("This cannot be undone.")}`
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
                    : t("Failed to delete dataset")
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
            <div className="flex min-h-52 flex-col items-center justify-center gap-3 border-y border-dashed py-10 text-center">
                <Database size={28} className="text-gray-400" aria-hidden="true" />
                <p className={`text-sm font-medium ${loadError ? "text-red-700" : "text-gray-700"}`}>
                    {t(loadError ? "Datasets unavailable" : canManage ? "No saved datasets" : "No shared datasets")}
                </p>
                {!canManage && !loadError && <p className="text-sm text-gray-500">{t("No datasets have been shared with this workspace yet.")}</p>}
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

            <div className="grid grid-cols-3 gap-3 border-b pb-5">
                <DatasetStat
                    icon={Database}
                    label={t("Datasets")}
                    value={datasets.length}
                />
                <DatasetStat
                    icon={Table2}
                    label={t("Rows")}
                    value={totalRows}
                />
                <DatasetStat
                    icon={FileText}
                    label={t("Columns")}
                    value={totalColumns}
                    detail={`${sourceCount} ${t(sourceCount === 1 ? "source type" : "source types")}`}
                />
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-[minmax(0,1fr)_11rem_11rem]">
                <label className="relative col-span-2 min-w-0 lg:col-span-1">
                    <span className="sr-only">{t("Search datasets")}</span>
                    <Search size={16} className="pointer-events-none absolute left-3 top-3 text-gray-400" aria-hidden="true" />
                    <input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(1) }} placeholder={t("Search datasets")} className="h-10 w-full rounded-lg border bg-white pl-9 pr-10 text-sm" />
                    {query && <button type="button" title={t("Clear search")} aria-label={t("Clear search")} onClick={() => { setQuery(""); setPage(1) }} className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"><X size={15} aria-hidden="true" /></button>}
                </label>
                <select aria-label={t("Filter by source")} value={source} onChange={event => { setSource(event.target.value); setPage(1) }} className="h-10 w-full min-w-0 truncate rounded-lg border bg-white px-3 text-sm">
                    <option value="">{t("All sources")}</option>
                    {sourceLabels.map(label => <option key={label} value={label}>{label}</option>)}
                </select>
                <select aria-label={t("Sort datasets")} value={sort} onChange={event => { setSort(event.target.value); setPage(1) }} className="h-10 w-full min-w-0 truncate rounded-lg border bg-white px-3 text-sm">
                    <option value="newest">{t("Newest first")}</option>
                    <option value="oldest">{t("Oldest first")}</option>
                    <option value="name">{t("Name A to Z")}</option>
                    <option value="rows">{t("Most rows")}</option>
                </select>
            </div>
            <div className="flex min-h-6 flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
                <p role="status" aria-live="polite">{filteredDatasets.length.toLocaleString()} {t(filteredDatasets.length === 1 ? "dataset" : "datasets")}</p>
                {(query || source) && <button type="button" onClick={resetFilters} className="font-medium text-[var(--decisionate-brand-primary-text)] hover:underline">{t("Clear filters")}</button>}
            </div>
            <div className="divide-y overflow-hidden rounded-lg border bg-white">
                {filteredDatasets.slice(start, start + pageSize).map((dataset) => (
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
                {!filteredDatasets.length && <div className="flex min-h-44 flex-col items-center justify-center gap-3 px-4 py-8 text-center"><Search size={24} className="text-gray-400" aria-hidden="true" /><p className="text-sm font-medium text-gray-700">{t("No matching datasets")}</p><button type="button" onClick={resetFilters} className="text-sm font-medium text-[var(--decisionate-brand-primary-text)] hover:underline">{t("Clear filters")}</button></div>}
            </div>
            {pageCount > 1 && <nav aria-label={t("Dataset pages")} className="flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500">
                <span>{start + 1}-{Math.min(start + pageSize, filteredDatasets.length)} {t("of")} {filteredDatasets.length.toLocaleString()}</span>
                <div className="flex items-center gap-3">
                    <button type="button" aria-label={t("Previous page")} title={t("Previous page")} disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className="flex h-9 w-9 items-center justify-center rounded-md border bg-white text-gray-600 disabled:opacity-40"><ChevronLeft size={16} aria-hidden="true" /></button>
                    <span>{currentPage} / {pageCount}</span>
                    <button type="button" aria-label={t("Next page")} title={t("Next page")} disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)} className="flex h-9 w-9 items-center justify-center rounded-md border bg-white text-gray-600 disabled:opacity-40"><ChevronRight size={16} aria-hidden="true" /></button>
                </div>
            </nav>}
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
        <div className="min-w-0 border-l-2 border-gray-200 pl-3">
            <div className="flex items-center gap-2">
                <div className="hidden shrink-0 text-gray-500 sm:block">
                    <Icon size={16} aria-hidden="true" />
                </div>

                <div>
                    <p className="break-words text-lg font-semibold text-gray-900 sm:text-xl">
                        {value.toLocaleString()}
                    </p>

                    <p className="text-xs font-medium uppercase text-gray-500">
                        {label}
                    </p>
                </div>
            </div>

            {detail && (
                <p className="mt-1 text-xs text-gray-500">
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
    const { t } = useDecisionateText()
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
        <div className="flex items-center gap-3 px-4 py-3 transition hover:bg-gray-50" aria-busy={deletingDatasetId === dataset.id}>
            <Link
                href={`/dashboard/datasets/${dataset.id}`}
                className="min-w-0 flex-1 rounded-md"
            >
                <div className="flex min-w-0 items-center gap-3">
                    <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-500 sm:flex">
                        <FileText size={17} aria-hidden="true" />
                    </div>

                    <div className="min-w-0">
                        <div title={dataset.file_name} className="truncate text-sm font-medium text-gray-900">
                            {dataset.file_name}
                        </div>

                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-500">
                            <span>
                                {dataset.row_count.toLocaleString()} {t("rows")}
                            </span>
                            <span>
                                {dataset.column_count.toLocaleString()} {t("columns")}
                            </span>
                            <span>{sourceDetails.label}</span>
                            {createdAt && (
                                <span className="hidden sm:inline">
                                    {t("Added")} {createdAt}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

            </Link>

            <div className="flex shrink-0 items-center gap-1">
                <Link
                    href={`/dashboard/datasets/${dataset.id}`}
                    aria-label={`${t("View dataset")}: ${dataset.file_name}`}
                    title={t("View dataset")}
                    className="flex h-9 w-9 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                >
                    <ArrowRight size={17} aria-hidden="true" />
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
                            deletingDatasetId !== null
                        }
                        className="flex h-9 w-9 items-center justify-center rounded-md text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                        title={t("Delete dataset")}
                        aria-label={`${t("Delete dataset")}: ${dataset.file_name}`}
                    >
                        {deletingDatasetId ===
                        dataset.id
                            ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
                            : <Trash2 size={16} aria-hidden="true" />}
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
