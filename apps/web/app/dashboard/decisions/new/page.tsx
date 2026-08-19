"use client"

import Link from "next/link"
import {
    useRouter,
    useSearchParams,
} from "next/navigation"
import {
    Suspense,
    useCallback,
    useEffect,
    useState,
} from "react"
import { useUser } from "@clerk/nextjs"
import {
    ArrowLeft,
    Plus,
    X,
} from "lucide-react"

import {
    createDecision,
    getDatasets,
    getDatasetMetrics,
    getDecisionTemplates,
    type DatasetSummary,
    type DecisionCategory,
    type DecisionConfidenceScore,
    type DecisionPriority,
    type DecisionTemplate,
} from "@/lib/api"
import {
    decisionCategoryOptions,
    decisionConfidenceOptions,
    decisionPriorityOptions,
    defaultDecisionCategory,
    defaultDecisionPriority,
} from "@/lib/decision-options"
import {
    useActiveWorkspace,
} from "@/lib/use-active-workspace"
import {
    useWorkspaceAccess,
} from "@/lib/use-workspace-access"
import {
    getDatasetSourceDetails,
} from "@/features/datasets/lib/source-config"
import {
    MetricSelector,
    formatMetricLabel,
} from "@/features/dashboard/components/metric-selector"
import { DashboardPageHeader } from "@/features/dashboard/components/dashboard-page-header"

type DecisionDatasetOption = Pick<
    DatasetSummary,
    | "id"
    | "file_name"
    | "source_type"
    | "source_config"
    | "source_label"
>

const reviewDateQuickActions = [
    {
        label: "7 days",
        days: 7,
    },
    {
        label: "30 days",
        days: 30,
    },
    {
        label: "90 days",
        days: 90,
    },
]

function getCreateDecisionDatasetId(
    value: string
) {
    const datasetId = Number(value)

    return Number.isInteger(datasetId) &&
        datasetId > 0
        ? datasetId
        : null
}

function getDateInputValueFromToday(days: number) {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() + days)

    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, "0")
    const day = String(date.getDate()).padStart(2, "0")

    return `${year}-${month}-${day}`
}

function getDecisionPageErrorMessage(
    error: unknown,
    fallbackMessage: string
) {
    return error instanceof Error &&
        error.message
        ? error.message
        : fallbackMessage
}

function applyDecisionTemplateTokens(
    value: string,
    metric?: string
) {
    return value.replace(
        /\{metric\}/g,
        metric ? formatMetricLabel(metric) : "key metric"
    )
}

function getSafeReturnPath(
    value: string | null
) {
    if (
        !value ||
        !value.startsWith("/dashboard") ||
        value.startsWith("//") ||
        value.includes("://")
    ) {
        return "/dashboard/decisions"
    }

    return value
}

function formatDecisionDatasetOption(
    dataset: DecisionDatasetOption
) {
    const sourceDetails =
        getDatasetSourceDetails(
            dataset.source_type,
            dataset.source_config,
            dataset.source_label
        )

    return `${dataset.file_name} (${sourceDetails.label})`
}

function formatDecisionDatasetSourceLabel(
    dataset: DecisionDatasetOption
) {
    return getDatasetSourceDetails(
        dataset.source_type,
        dataset.source_config,
        dataset.source_label
    ).label
}

function NewDecisionContent() {
    const { user } = useUser()
    const router = useRouter()
    const searchParams = useSearchParams()
    const {
        activeWorkspaceId,
        workspaceVersion,
    } =
        useActiveWorkspace(user?.id)
    const {
        canManageWorkspaceData,
        loadingWorkspaceAccess,
    } = useWorkspaceAccess(user?.id)

    const returnPath =
        getSafeReturnPath(
            searchParams.get("returnTo")
        )
    const initialDatasetId =
        getCreateDecisionDatasetId(
            searchParams.get("dataset") ?? ""
        )
    const initialTemplateSlug =
        searchParams.get("template") ?? ""
    const initialMetric =
        searchParams.get("metric") ?? ""

    const [decisionDatasets, setDecisionDatasets] =
        useState<DecisionDatasetOption[]>([])
    const [decisionTemplates, setDecisionTemplates] =
        useState<DecisionTemplate[]>([])
    const [selectedTemplateSlug, setSelectedTemplateSlug] =
        useState("")
    const [createDatasetId, setCreateDatasetId] =
        useState("")
    const [selectedMetric, setSelectedMetric] =
        useState<string>()
    const [decisionMetricColumns, setDecisionMetricColumns] =
        useState<string[]>([])
    const [loadingMetrics, setLoadingMetrics] =
        useState(false)
    const [createDecisionTitle, setCreateDecisionTitle] =
        useState("")
    const [createDecisionAction, setCreateDecisionAction] =
        useState("")
    const [createDecisionDescription, setCreateDecisionDescription] =
        useState("")
    const [createDecisionExpectedOutcome, setCreateDecisionExpectedOutcome] =
        useState("")
    const [createDecisionPriority, setCreateDecisionPriority] =
        useState<DecisionPriority>(defaultDecisionPriority)
    const [createDecisionCategory, setCreateDecisionCategory] =
        useState<DecisionCategory>(defaultDecisionCategory)
    const [createDecisionConfidence, setCreateDecisionConfidence] =
        useState<DecisionConfidenceScore | "">("")
    const [createDecisionReviewDate, setCreateDecisionReviewDate] =
        useState("")
    const [creatingDecision, setCreatingDecision] =
        useState(false)
    const [loadingDatasets, setLoadingDatasets] =
        useState(false)
    const [datasetLoadRetryKey, setDatasetLoadRetryKey] =
        useState(0)
    const [metricLoadRetryKey, setMetricLoadRetryKey] =
        useState(0)
    const [metricLoadError, setMetricLoadError] =
        useState("")
    const [createDecisionError, setCreateDecisionError] =
        useState("")

    const selectedDecisionDataset =
        decisionDatasets.find(
            dataset =>
                String(dataset.id) ===
                createDatasetId
        )
    const selectedDecisionDatasetLabel =
        selectedDecisionDataset
            ? formatDecisionDatasetOption(
                selectedDecisionDataset
            )
            : undefined
    const selectedDecisionDatasetSourceLabel =
        selectedDecisionDataset
            ? formatDecisionDatasetSourceLabel(
                selectedDecisionDataset
            )
            : undefined
    const selectedDecisionTemplate =
        decisionTemplates.find(
            template =>
                template.slug === selectedTemplateSlug
        )
    const canCreateDecision =
        Boolean(createDecisionTitle.trim()) &&
        Boolean(createDecisionAction.trim()) &&
        Boolean(createDecisionExpectedOutcome.trim()) &&
        Boolean(createDatasetId) &&
        !creatingDecision &&
        canManageWorkspaceData

    const applyDecisionTemplate = useCallback(
        (
            template: DecisionTemplate | undefined,
            metric = initialMetric
        ) => {
        if (!template) {
            setSelectedTemplateSlug("")
            setCreateDecisionTitle("")
            setCreateDecisionAction("")
            setCreateDecisionDescription("")
            setCreateDecisionExpectedOutcome("")
            setCreateDecisionPriority(defaultDecisionPriority)
            setCreateDecisionCategory(defaultDecisionCategory)
            setCreateDecisionConfidence("")
            setCreateDecisionReviewDate("")
            return
        }

        setSelectedTemplateSlug(template.slug)
        setCreateDecisionTitle(
            applyDecisionTemplateTokens(
                template.title_template,
                metric
            )
        )
        setCreateDecisionAction(
            applyDecisionTemplateTokens(
                template.decision_description,
                metric
            )
        )
        setCreateDecisionDescription(
            applyDecisionTemplateTokens(
                template.decision_description,
                metric
            )
        )
        setCreateDecisionExpectedOutcome(
            applyDecisionTemplateTokens(
                template.expected_outcome,
                metric
            )
        )
        setCreateDecisionPriority(template.priority)
        setCreateDecisionCategory(template.category)
        setCreateDecisionConfidence(
            template.confidence_score
        )
        setCreateDecisionReviewDate(
            getDateInputValueFromToday(
                template.review_days
            )
        )
        },
        [initialMetric]
    )

    useEffect(() => {
        if (
            !user?.id ||
            loadingWorkspaceAccess ||
            canManageWorkspaceData
        ) {
            return
        }

        router.replace(returnPath)
    }, [
        canManageWorkspaceData,
        loadingWorkspaceAccess,
        returnPath,
        router,
        user?.id,
    ])

    useEffect(() => {
        if (!user?.id) return
        const userId = user.id
        let ignoreResult = false

        async function loadDecisionDatasets() {
            try {
                setLoadingDatasets(true)
                setCreateDecisionError("")
                setDecisionDatasets([])
                setCreateDatasetId("")
                setDecisionTemplates([])
                setSelectedTemplateSlug("")

                const [datasetsResult, templatesResult] =
                    await Promise.allSettled([
                        getDatasets(
                            userId,
                            activeWorkspaceId
                        ),
                        getDecisionTemplates(
                            userId,
                            activeWorkspaceId
                        ),
                    ])

                if (ignoreResult) {
                    return
                }

                if (datasetsResult.status === "rejected") {
                    throw datasetsResult.reason
                }

                const datasetData = datasetsResult.value

                setDecisionDatasets(datasetData)

                const templateData =
                    templatesResult.status === "fulfilled"
                        ? templatesResult.value
                        : []
                setDecisionTemplates(templateData)

                const requestedTemplate =
                    templateData.find(
                        template =>
                            template.slug ===
                            initialTemplateSlug
                    )
                if (requestedTemplate) {
                    applyDecisionTemplate(
                        requestedTemplate,
                        initialMetric
                    )
                }

                let nextDatasetId: number | undefined
                if (datasetData.length > 0) {
                    const initialDataset =
                        initialDatasetId
                            ? datasetData.find(
                                dataset =>
                                    dataset.id ===
                                    initialDatasetId
                            )
                            : undefined

                    nextDatasetId =
                        initialDataset?.id

                    setCreateDecisionReviewDate(
                        currentReviewDate =>
                            currentReviewDate ||
                            getDateInputValueFromToday(30)
                    )
                }

                setCreateDatasetId(
                    nextDatasetId
                        ? String(nextDatasetId)
                        : ""
                )
                setSelectedMetric(undefined)
                setLoadingDatasets(false)

            } catch (error) {
                if (ignoreResult) {
                    return
                }

                console.error(error)
                setDecisionDatasets([])
                setCreateDecisionError(
                    getDecisionPageErrorMessage(
                        error,
                        "Could not load datasets for decision creation."
                    )
                )
            } finally {
                if (!ignoreResult) {
                    setLoadingDatasets(false)
                }
            }
        }

        void loadDecisionDatasets()

        return () => {
            ignoreResult = true
            setLoadingDatasets(false)
        }
    }, [
        activeWorkspaceId,
        datasetLoadRetryKey,
        initialDatasetId,
        initialMetric,
        initialTemplateSlug,
        applyDecisionTemplate,
        user?.id,
        workspaceVersion,
    ])

    useEffect(() => {
        const datasetId =
            getCreateDecisionDatasetId(
                createDatasetId
            )

        if (!user?.id || datasetId === null) {
            return
        }

        const userId = user.id
        const safeDatasetId = datasetId
        let ignoreResult = false

        async function loadDecisionMetrics() {
            try {
                setLoadingMetrics(true)
                setMetricLoadError("")
                setDecisionMetricColumns([])

                const data =
                    await getDatasetMetrics(
                        safeDatasetId,
                        userId,
                        activeWorkspaceId
                    )

                if (ignoreResult) {
                    return
                }

                const metricColumns =
                    Array.from(
                        new Set(
                            data.metrics
                                .map(metric =>
                                    metric.column.trim()
                                )
                                .filter(Boolean)
                        )
                    )

                setDecisionMetricColumns(
                    metricColumns
                )

                if (
                    initialMetric &&
                    metricColumns.includes(initialMetric)
                ) {
                    setSelectedMetric(initialMetric)
                }

                setSelectedMetric(currentMetric =>
                    currentMetric &&
                    !metricColumns.includes(currentMetric)
                        ? undefined
                        : currentMetric
                )
            } catch (error) {
                if (!ignoreResult) {
                    console.error(error)
                    setDecisionMetricColumns([])
                    setMetricLoadError(
                        getDecisionPageErrorMessage(
                            error,
                            "Could not load metrics for this dataset."
                        )
                    )
                }
            } finally {
                if (!ignoreResult) {
                    setLoadingMetrics(false)
                }
            }
        }

        void loadDecisionMetrics()

        return () => {
            ignoreResult = true
        }
    }, [
        activeWorkspaceId,
        createDatasetId,
        initialMetric,
        metricLoadRetryKey,
        user?.id,
        workspaceVersion,
    ])

    useEffect(() => {
        const datasetId =
            getCreateDecisionDatasetId(
                createDatasetId
            )

        if (
            !user?.id ||
            datasetId === null ||
            !selectedMetric ||
            loadingMetrics ||
            decisionMetricColumns.includes(
                selectedMetric
            )
        ) {
            return
        }

        queueMicrotask(() =>
            setSelectedMetric(undefined)
        )
    }, [
        activeWorkspaceId,
        createDatasetId,
        decisionMetricColumns,
        loadingMetrics,
        selectedMetric,
        user?.id,
    ])

    function handleClose() {
        router.push(returnPath)
    }

    function handleDatasetChange(
        datasetValue: string
    ) {
        setCreateDecisionError("")
        setCreateDatasetId(datasetValue)
        setSelectedMetric(undefined)
        setMetricLoadError("")
        setDecisionMetricColumns([])
        setLoadingMetrics(false)

        const datasetId =
            getCreateDecisionDatasetId(
                datasetValue
            )

        if (datasetId === null) {
            return
        }
    }

    function handleMetricChange(
        metric: string | undefined
    ) {
        setSelectedMetric(metric)

        if (selectedDecisionTemplate) {
            applyDecisionTemplate(
                selectedDecisionTemplate,
                metric
            )
        }

        setCreateDecisionError("")
    }

    function handleTemplateChange(
        templateSlug: string
    ) {
        const template =
            decisionTemplates.find(
                item => item.slug === templateSlug
            )
        applyDecisionTemplate(
            template,
            selectedMetric || initialMetric
        )
        setCreateDecisionError("")
    }

    async function handleCreateDecision(
        event: React.FormEvent<HTMLFormElement>
    ) {
        event.preventDefault()

        if (!user?.id || creatingDecision) return

        const cleanTitle =
            createDecisionTitle.trim()
        const cleanExpectedOutcome =
            createDecisionExpectedOutcome.trim()
        const datasetId =
            getCreateDecisionDatasetId(
                createDatasetId
            )

        if (
            !cleanTitle ||
            !createDecisionAction.trim() ||
            datasetId === null ||
            !cleanExpectedOutcome
        ) {
            setCreateDecisionError(
                "Choose a dataset, add a decision title and action, and define the expected outcome."
            )
            return
        }

        setCreatingDecision(true)
        setCreateDecisionError("")

        try {
            await createDecision(
                {
                    dataset_id: datasetId,
                    metric_column: selectedMetric,
                    title: cleanTitle,
                    action: createDecisionAction.trim(),
                    description:
                        createDecisionDescription.trim() || undefined,
                    expected_outcome: cleanExpectedOutcome,
                    priority: createDecisionPriority,
                    category: createDecisionCategory,
                    confidence_score:
                        createDecisionConfidence || undefined,
                    review_date: createDecisionReviewDate
                        ? `${createDecisionReviewDate}T00:00:00`
                        : undefined,
                },
                user.id,
                activeWorkspaceId
            )

            router.push(returnPath)
        } catch (error) {
            console.error(error)
            setCreateDecisionError(
                getDecisionPageErrorMessage(
                    error,
                    "Decision could not be created."
                )
            )
        } finally {
            setCreatingDecision(false)
        }
    }

    return (
        <div className="mx-auto max-w-5xl space-y-6">
            <DashboardPageHeader
                leading={
                    <Link
                        href={returnPath}
                        className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 transition hover:text-[var(--decisionate-brand-primary-text)]"
                    >
                        <ArrowLeft size={16} />
                        Back
                    </Link>
                }
                title="New Decision"
                description="Create a focused decision record from a dataset, then return to where you started."
                actions={
                    <button
                    type="button"
                    onClick={handleClose}
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                >
                    <X size={16} />
                    Cancel
                    </button>
                }
            />

            <DashboardCard>

                {loadingDatasets ? (
                    <p className="text-sm text-gray-500">
                        Loading datasets...
                    </p>
                ) : decisionDatasets.length > 0 ? (
                    <form
                        onSubmit={handleCreateDecision}
                        className="grid min-w-0 gap-4 lg:grid-cols-3"
                    >
                        {decisionTemplates.length > 0 && (
                            <div className="min-w-0 lg:col-span-3">
                                <label
                                    htmlFor="decision-template"
                                    className="text-xs font-medium uppercase tracking-wider text-gray-500"
                                >
                                    Decision template
                                </label>

                                <select
                                    id="decision-template"
                                    value={selectedTemplateSlug}
                                    onChange={(event) =>
                                        handleTemplateChange(
                                            event.target.value
                                        )
                                    }
                                    className="mt-1 block h-10 w-full rounded-lg border border-gray-200 bg-white px-3 pr-9 text-sm text-gray-700 focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
                                >
                                    <option value="">
                                        Start from scratch
                                    </option>

                                    {decisionTemplates.map(template => (
                                        <option
                                            key={template.slug}
                                            value={template.slug}
                                        >
                                            {template.name}
                                        </option>
                                    ))}
                                </select>

                                <p className="mt-2 text-xs text-gray-500">
                                    Choose a starting structure, then adjust every field for this decision.
                                </p>
                                {selectedDecisionTemplate && (
                                    <p className="mt-1 text-xs text-gray-600">
                                        {selectedDecisionTemplate.description}
                                    </p>
                                )}
                            </div>
                        )}

                        <div className="min-w-0">
                            <label
                                htmlFor="decision-title"
                                className="text-xs font-medium uppercase tracking-wider text-gray-500"
                            >
                                Decision Title
                            </label>

                            <input
                                id="decision-title"
                                value={createDecisionTitle}
                                onChange={(event) => {
                                    setCreateDecisionError("")
                                    setCreateDecisionTitle(
                                        event.target.value
                                    )
                                }}
                                placeholder="e.g. Increase retention campaign budget"
                                className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
                            />
                        </div>

                        <div className="min-w-0">
                            <label
                                htmlFor="decision-dataset"
                                className="text-xs font-medium uppercase tracking-wider text-gray-500"
                            >
                                Dataset
                            </label>

                            <select
                                id="decision-dataset"
                                value={createDatasetId}
                                title={
                                    selectedDecisionDatasetLabel ??
                                    "Choose dataset"
                                }
                                onChange={(event) => {
                                    void handleDatasetChange(
                                        event.target.value
                                    )
                                }}
                                className="mt-1 block h-10 w-full max-w-full truncate rounded-lg border border-gray-200 px-3 pr-9 text-sm text-gray-700 focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
                            >
                                <option value="">
                                    Choose dataset
                                </option>

                                {decisionDatasets.map(dataset => (
                                    <option
                                        key={dataset.id}
                                        value={dataset.id}
                                    >
                                        {formatDecisionDatasetOption(
                                            dataset
                                        )}
                                    </option>
                                ))}
                            </select>

                            {selectedDecisionDataset && (
                                <p className="mt-2 max-w-full break-words text-xs text-gray-500">
                                    Source:{" "}
                                    <span className="font-medium text-gray-600">
                                        {selectedDecisionDatasetSourceLabel}
                                    </span>
                                    {" · "}
                                    <Link
                                        href={`/dashboard/datasets/${selectedDecisionDataset.id}`}
                                        className="font-medium text-[var(--decisionate-brand-primary-text)] hover:opacity-80"
                                    >
                                        Open dataset
                                    </Link>
                                </p>
                            )}
                        </div>

                        <div className="min-w-0">
                            <label
                                htmlFor="decision-metric"
                                className="text-xs font-medium uppercase tracking-wider text-gray-500"
                            >
                                Metric
                            </label>

                            <MetricSelector
                                ariaLabel="Select decision metric"
                                metrics={decisionMetricColumns}
                                value={selectedMetric}
                                loadError={Boolean(metricLoadError)}
                                disabled={
                                    !createDatasetId ||
                                    loadingMetrics ||
                                    decisionMetricColumns.length === 0
                                }
                                placeholder={
                                    !createDatasetId
                                        ? "Choose dataset first"
                                        : loadingMetrics
                                            ? "Loading metrics..."
                                            : decisionMetricColumns.length === 0
                                                ? "No numeric metrics"
                                                : "All Metrics"
                                }
                                onChange={(metric) => {
                                    void handleMetricChange(metric)
                                }}
                            />

                            {metricLoadError && (
                                <div
                                    role="alert"
                                    className="mt-2 flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 sm:flex-row sm:items-center sm:justify-between"
                                >
                                    <span>{metricLoadError}</span>

                                    <button
                                        type="button"
                                        onClick={() =>
                                            setMetricLoadRetryKey(
                                                currentKey => currentKey + 1
                                            )
                                        }
                                        className="w-fit rounded-md border border-red-200 bg-white px-2 py-1 font-medium text-red-700 transition hover:bg-red-100"
                                    >
                                        Retry metrics
                                    </button>
                                </div>
                            )}

                            <p className="mt-2 text-xs text-gray-500">
                                {selectedMetric
                                    ? `Focused on ${formatMetricLabel(selectedMetric)}. This metric will be saved with the decision.`
                                    : "Optional focus for this decision. The record remains linked to the selected dataset."}
                            </p>
                        </div>

                        <div className="min-w-0 lg:col-span-3">
                            <label
                                htmlFor="decision-action"
                                className="text-xs font-medium uppercase tracking-wider text-gray-500"
                            >
                                Action
                                <span className="ml-1 text-amber-600">
                                    Required
                                </span>
                            </label>

                            <textarea
                                id="decision-action"
                                value={createDecisionAction}
                                onChange={(event) => {
                                    setCreateDecisionError("")
                                    setCreateDecisionAction(
                                        event.target.value
                                    )
                                }}
                                placeholder="What will you do? For example: Increase paid search ad spend by 50% for 30 days."
                                rows={3}
                                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
                            />
                        </div>

                        <div className="min-w-0 lg:col-span-3">
                            <label
                                htmlFor="decision-description"
                                className="text-xs font-medium uppercase tracking-wider text-gray-500"
                            >
                                Description
                            </label>

                            <textarea
                                id="decision-description"
                                value={createDecisionDescription}
                                onChange={(event) => {
                                    setCreateDecisionError("")
                                    setCreateDecisionDescription(
                                        event.target.value
                                    )
                                }}
                                placeholder="Optional context, hypothesis, or expected business impact."
                                rows={3}
                                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
                            />
                        </div>

                        <div className="min-w-0 lg:col-span-3">
                            <label
                                htmlFor="decision-expected-outcome"
                                className="text-xs font-medium uppercase tracking-wider text-gray-500"
                            >
                                Expected Outcome
                                <span className="ml-1 text-amber-600">
                                    Required
                                </span>
                            </label>

                            <textarea
                                id="decision-expected-outcome"
                                value={createDecisionExpectedOutcome}
                                onChange={(event) => {
                                    setCreateDecisionError("")
                                    setCreateDecisionExpectedOutcome(
                                        event.target.value
                                    )
                                }}
                                placeholder="Success criteria, hypothesis, or measurable target this decision should be judged against."
                                rows={3}
                                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
                            />
                        </div>

                        <div className="min-w-0">
                            <label
                                htmlFor="decision-priority"
                                className="text-xs font-medium uppercase tracking-wider text-gray-500"
                            >
                                Priority
                            </label>

                            <select
                                id="decision-priority"
                                value={createDecisionPriority}
                                onChange={(event) => {
                                    setCreateDecisionError("")
                                    setCreateDecisionPriority(
                                        event.target.value as DecisionPriority
                                    )
                                }}
                                className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
                            >
                                {decisionPriorityOptions.map(option => (
                                    <option
                                        key={option.value}
                                        value={option.value}
                                    >
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="min-w-0">
                            <label
                                htmlFor="decision-category"
                                className="text-xs font-medium uppercase tracking-wider text-gray-500"
                            >
                                Category
                            </label>

                            <select
                                id="decision-category"
                                value={createDecisionCategory}
                                onChange={(event) => {
                                    setCreateDecisionError("")
                                    setCreateDecisionCategory(
                                        event.target.value as DecisionCategory
                                    )
                                }}
                                className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
                            >
                                {decisionCategoryOptions.map(option => (
                                    <option
                                        key={option.value}
                                        value={option.value}
                                    >
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="min-w-0">
                            <label
                                htmlFor="decision-confidence"
                                className="text-xs font-medium uppercase tracking-wider text-gray-500"
                            >
                                Confidence
                            </label>

                            <select
                                id="decision-confidence"
                                value={createDecisionConfidence}
                                onChange={(event) => {
                                    setCreateDecisionError("")
                                    setCreateDecisionConfidence(
                                        event.target.value as
                                            | DecisionConfidenceScore
                                            | ""
                                    )
                                }}
                                className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
                            >
                                <option value="">Set later</option>
                                {decisionConfidenceOptions.map(option => (
                                    <option
                                        key={option.value}
                                        value={option.value}
                                    >
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="min-w-0">
                            <label
                                htmlFor="decision-review-date"
                                className="text-xs font-medium uppercase tracking-wider text-gray-500"
                            >
                                Review Date
                            </label>

                            <input
                                id="decision-review-date"
                                type="date"
                                value={createDecisionReviewDate}
                                onChange={(event) => {
                                    setCreateDecisionError("")
                                    setCreateDecisionReviewDate(
                                        event.target.value
                                    )
                                }}
                                className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
                            />

                            <div className="mt-2 flex flex-wrap gap-2">
                                {reviewDateQuickActions.map(action => (
                                    <button
                                        key={action.days}
                                        type="button"
                                        onClick={() => {
                                            setCreateDecisionError("")
                                            setCreateDecisionReviewDate(
                                                getDateInputValueFromToday(
                                                    action.days
                                                )
                                            )
                                        }}
                                        className="rounded-full border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] px-3 py-1 text-xs font-medium text-[var(--decisionate-brand-primary-text)] transition hover:opacity-80"
                                    >
                                        In {action.label}
                                    </button>
                                ))}
                            </div>

                            <p className="mt-2 text-xs text-gray-500">
                                Defaults to 30 days so every decision has a review loop.
                            </p>
                        </div>

                        {createDecisionError && (
                            <p className="text-sm text-red-600 lg:col-span-3">
                                {createDecisionError}
                            </p>
                        )}

                        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap lg:col-span-3">
                            <button
                                type="submit"
                                disabled={!canCreateDecision}
                                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--decisionate-brand-primary)] px-4 text-sm font-medium text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 sm:w-auto"
                            >
                                <Plus size={16} />
                                {creatingDecision
                                    ? "Creating..."
                                    : "Create Decision"}
                            </button>

                            <button
                                type="button"
                                onClick={handleClose}
                                className="inline-flex h-11 w-full items-center justify-center rounded-xl border px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50 sm:w-auto"
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                ) : (
                    <div>
                        {createDecisionError ? (
                            <div
                                role="alert"
                                className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between"
                            >
                                <span>{createDecisionError}</span>

                                <button
                                    type="button"
                                    onClick={() =>
                                        setDatasetLoadRetryKey(
                                            currentKey => currentKey + 1
                                        )
                                    }
                                    className="w-fit rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-700 transition hover:bg-red-100"
                                >
                                    Retry dataset load
                                </button>
                            </div>
                        ) : (
                            <p className="text-sm text-gray-500">
                                Upload a dataset first so each decision has a clear source of context.
                            </p>
                        )}

                        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                            <Link
                                href="/dashboard/datasets"
                                className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-[var(--decisionate-brand-primary-ring)] px-3 text-sm font-medium text-[var(--decisionate-brand-primary-text)] transition hover:bg-[var(--decisionate-brand-primary-soft)] sm:w-auto"
                            >
                                Upload Dataset
                            </Link>

                            <button
                                type="button"
                                onClick={handleClose}
                                className="inline-flex h-11 w-full items-center justify-center rounded-xl border px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 sm:w-auto"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </DashboardCard>
        </div>
    )
}

export default function NewDecisionPage() {
    return (
        <Suspense
            fallback={
                <div
                    role="status"
                    aria-live="polite"
                    className="mx-auto max-w-5xl rounded-2xl border bg-white p-6 text-sm text-gray-500 shadow-sm"
                >
                    Loading decision form...
                </div>
            }
        >
            <NewDecisionContent />
        </Suspense>
    )
}

function DashboardCard({
    children,
    className = "",
}: {
    children: React.ReactNode
    className?: string
}) {
    return (
        <div
            className={`min-w-0 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm ${className}`}
        >
            {children}
        </div>
    )
}
