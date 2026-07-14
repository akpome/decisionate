"use client"

import Link from "next/link"
import {
    useRouter,
    useSearchParams,
} from "next/navigation"
import {
    Suspense,
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
    type DatasetSummary,
    type DecisionCategory,
    type DecisionConfidenceScore,
    type DecisionPriority,
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
    getDatasetSourceDetails,
} from "@/features/datasets/lib/source-config"

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

function NewDecisionContent() {
    const { user } = useUser()
    const router = useRouter()
    const searchParams = useSearchParams()
    const {
        activeWorkspaceId,
        workspaceVersion,
    } =
        useActiveWorkspace(user?.id)

    const returnPath =
        getSafeReturnPath(
            searchParams.get("returnTo")
        )
    const initialDatasetId =
        getCreateDecisionDatasetId(
            searchParams.get("dataset") ?? ""
        )

    const [decisionDatasets, setDecisionDatasets] =
        useState<DecisionDatasetOption[]>([])
    const [createDatasetId, setCreateDatasetId] =
        useState("")
    const [createDecisionTitle, setCreateDecisionTitle] =
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
    const [createDecisionError, setCreateDecisionError] =
        useState("")

    const canCreateDecision =
        Boolean(createDecisionTitle.trim()) &&
        Boolean(createDatasetId) &&
        !creatingDecision

    useEffect(() => {
        if (!user?.id) return
        const userId = user.id

        async function loadDecisionDatasets() {
            try {
                setLoadingDatasets(true)
                setCreateDecisionError("")

                const datasetData =
                    await getDatasets(
                        userId,
                        activeWorkspaceId
                    )

                setDecisionDatasets(datasetData)

                if (datasetData.length > 0) {
                    const initialDataset =
                        initialDatasetId
                            ? datasetData.find(
                                dataset =>
                                    dataset.id ===
                                    initialDatasetId
                            )
                            : undefined

                    setCreateDatasetId(
                        currentDatasetId =>
                            currentDatasetId ||
                            String(
                                initialDataset?.id ??
                                datasetData[0].id
                            )
                    )
                }
            } catch (error) {
                console.error(error)
                setDecisionDatasets([])
                setCreateDecisionError(
                    getDecisionPageErrorMessage(
                        error,
                        "Could not load datasets for decision creation."
                    )
                )
            } finally {
                setLoadingDatasets(false)
            }
        }

        void loadDecisionDatasets()
    }, [
        activeWorkspaceId,
        initialDatasetId,
        user?.id,
        workspaceVersion,
    ])

    function handleClose() {
        router.push(returnPath)
    }

    async function handleCreateDecision(
        event: React.FormEvent<HTMLFormElement>
    ) {
        event.preventDefault()

        if (!user?.id || creatingDecision) return

        const cleanTitle =
            createDecisionTitle.trim()
        const datasetId =
            getCreateDecisionDatasetId(
                createDatasetId
            )

        if (!cleanTitle || datasetId === null) {
            setCreateDecisionError(
                "Choose a dataset and add a decision title."
            )
            return
        }

        setCreatingDecision(true)
        setCreateDecisionError("")

        try {
            await createDecision(
                {
                    dataset_id: datasetId,
                    title: cleanTitle,
                    description:
                        createDecisionDescription.trim() || undefined,
                    expected_outcome:
                        createDecisionExpectedOutcome.trim() || undefined,
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
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <Link
                        href={returnPath}
                        className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 transition hover:text-blue-700"
                    >
                        <ArrowLeft size={16} />
                        Back
                    </Link>

                    <h1 className="mt-3 text-3xl font-bold">
                        New Decision
                    </h1>

                    <p className="mt-2 text-gray-500">
                        Create a focused decision record from a dataset, then return to where you started.
                    </p>
                </div>

                <button
                    type="button"
                    onClick={handleClose}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                >
                    <X size={16} />
                    Cancel
                </button>
            </div>

            <DashboardCard>
                {loadingDatasets ? (
                    <p className="text-sm text-gray-500">
                        Loading datasets...
                    </p>
                ) : decisionDatasets.length > 0 ? (
                    <form
                        onSubmit={handleCreateDecision}
                        className="grid gap-4 lg:grid-cols-3"
                    >
                        <div className="lg:col-span-2">
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
                                className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                            />
                        </div>

                        <div>
                            <label
                                htmlFor="decision-dataset"
                                className="text-xs font-medium uppercase tracking-wider text-gray-500"
                            >
                                Dataset
                            </label>

                            <select
                                id="decision-dataset"
                                value={createDatasetId}
                                onChange={(event) => {
                                    setCreateDecisionError("")
                                    setCreateDatasetId(
                                        event.target.value
                                    )
                                }}
                                className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                            >
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
                        </div>

                        <div className="lg:col-span-3">
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
                                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                            />
                        </div>

                        <div className="lg:col-span-3">
                            <label
                                htmlFor="decision-expected-outcome"
                                className="text-xs font-medium uppercase tracking-wider text-gray-500"
                            >
                                Expected Outcome
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
                                placeholder="Optional success criteria, hypothesis, or measurable target."
                                rows={3}
                                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                            />
                        </div>

                        <div>
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
                                className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
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

                        <div>
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
                                className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
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

                        <div>
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
                                className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
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

                        <div>
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
                                className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
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
                                        className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 transition hover:bg-blue-100"
                                    >
                                        In {action.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {createDecisionError && (
                            <p className="text-sm text-red-600 lg:col-span-3">
                                {createDecisionError}
                            </p>
                        )}

                        <div className="flex flex-wrap gap-3 lg:col-span-3">
                            <button
                                type="submit"
                                disabled={!canCreateDecision}
                                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                            >
                                <Plus size={16} />
                                {creatingDecision
                                    ? "Creating..."
                                    : "Create Decision"}
                            </button>

                            <button
                                type="button"
                                onClick={handleClose}
                                className="inline-flex h-10 items-center justify-center rounded-lg border px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                ) : (
                    <div>
                        <p className="text-sm text-gray-500">
                            Upload a dataset first so each decision has a clear source of context.
                        </p>

                        <div className="mt-4 flex flex-wrap gap-3">
                            <Link
                                href="/dashboard/datasets"
                                className="inline-flex h-10 items-center justify-center rounded-lg border border-blue-200 px-3 text-sm font-medium text-blue-700 transition hover:bg-blue-50"
                            >
                                Upload Dataset
                            </Link>

                            <button
                                type="button"
                                onClick={handleClose}
                                className="inline-flex h-10 items-center justify-center rounded-lg border px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
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
                <div className="mx-auto max-w-5xl rounded-2xl border bg-white p-6 text-sm text-gray-500 shadow-sm">
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
            className={`rounded-2xl border border-gray-200 bg-white p-6 shadow-sm ${className}`}
        >
            {children}
        </div>
    )
}
