"use client"

import {
    getDecisionActivityFeed,
    getDecisionSummary,
    getDecisions,
} from "@/lib/api"
import {
    getDecisionActivityBadgeClass,
    getDecisionActivityDotClass,
} from "@/lib/decision-activity-style"
import {
    activeDecisionStatusOptions,
    allPortfolioLifecycle,
    archivedDecisionStatus,
    archivedPortfolioLifecycle,
    cancelledDecisionStatus,
    completedDecisionStatus,
    defaultPortfolioLifecycle,
    defaultDecisionSort,
    decisionCategoryOptions,
    decisionOutcomeStatusOptions,
    decisionSortOptions,
    formatDecisionLabel,
    inProgressDecisionStatus,
} from "@/lib/decision-options"
import {
    hasAddedNotes,
    hasCapturedLearning,
    hasPendingLearning,
    hasPendingNotes,
    hasPendingOutcome,
    hasPlannedOutcome,
    hasRecordedOutcome,
} from "@/lib/decision-outcomes"
import type {
    ActiveDecisionStatus,
} from "@/lib/decision-options"
import {
    useActiveWorkspace,
} from "@/lib/use-active-workspace"
import type {
    DecisionAttentionWorkflowState,
    DecisionCategory,
    DecisionActivityFeedItem,
    DecisionLearningWorkflowState,
    DecisionListLifecycle,
    DecisionNotesWorkflowState,
    DecisionOutcomeWorkflowState,
    DecisionReviewWorkflowState,
    DecisionListSort,
    DecisionOutcomeStatus,
    DecisionRecord,
    DecisionSummary,
} from "@/lib/api"
import {
    useEffect,
    useRef,
    useState,
} from "react"
import { useUser } from "@clerk/nextjs"
import Link from "next/link"

import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    Cell,
    LineChart,
    Line,
    CartesianGrid,
    LabelList,
} from "recharts"

import {
    BarChart3,
    Target,
    Calendar,
    Activity,
    ArrowRight,
    FolderOpen,
    Flag,
    FileText,
    Gauge,
    Lightbulb,
    BriefcaseBusiness,
    HeartPulse,
    Search,
    TrendingUp,
    RefreshCw,
    Plus,
    X,
} from "lucide-react"

type DecisionListRecord = DecisionRecord

function getDecisionPageErrorMessage(
    error: unknown,
    fallbackMessage: string
) {
    return error instanceof Error &&
        error.message
        ? error.message
        : fallbackMessage
}

type DecisionSummaryCountKey =
    | "by_status"
    | "by_outcome_status"
    | "by_category"

type PortfolioFilter = DecisionListLifecycle

type PortfolioStatusFilter =
    | ""
    | ActiveDecisionStatus

type PortfolioCategoryFilter =
    | ""
    | DecisionCategory

type PortfolioAttentionFilter =
    | ""
    | DecisionAttentionWorkflowState

type PortfolioOutcomeFilter =
    | ""
    | DecisionOutcomeWorkflowState

type PortfolioLearningFilter =
    | ""
    | DecisionLearningWorkflowState

type PortfolioNotesFilter =
    | ""
    | DecisionNotesWorkflowState

type PortfolioReviewFilter =
    | ""
    | DecisionReviewWorkflowState

type PortfolioSort = DecisionListSort

type ActivePortfolioFilterChip = {
    key: string
    label: string
    onClear: () => void
}

const healthyDecisionLabel = "Healthy"
const needsReviewDecisionLabel = "Needs Review"
const archivedDecisionLabel = "Archived"
const inProgressDecisionLabel = "In Progress"
const cancelledDecisionLabel = "Cancelled"
const plannedDecisionLabel = "Planned"

type DecisionHealthLabel =
    | typeof healthyDecisionLabel
    | typeof needsReviewDecisionLabel
    | typeof archivedDecisionLabel
    | typeof inProgressDecisionLabel
    | typeof cancelledDecisionLabel
    | typeof plannedDecisionLabel

function getInitialPortfolioAttentionFilter(): PortfolioAttentionFilter {
    if (typeof window === "undefined") {
        return ""
    }

    const params =
        new URLSearchParams(
            window.location.search
        )

    return params.get("attention") === "required"
        ? "required"
        : ""
}

const portfolioPageSize = 24
const activityFeedPageSize = 20

export default function DecisionsPage() {
    const { user } = useUser()
    const {
        activeWorkspaceId,
        workspaceVersion,
    } =
        useActiveWorkspace(user?.id)
    const portfolioLoadedOnce = useRef(false)
    const [decisions, setDecisions] = useState<DecisionListRecord[]>([])
    const [decisionSummary, setDecisionSummary] =
        useState<DecisionSummary | null>(null)
    const [decisionActivityFeed, setDecisionActivityFeed] =
        useState<DecisionActivityFeedItem[]>([])
    const [hasMoreDecisionActivity, setHasMoreDecisionActivity] =
        useState(false)
    const [decisionActivityLoading, setDecisionActivityLoading] =
        useState(false)
    const [decisionActivityError, setDecisionActivityError] =
        useState("")
    const [portfolioFilter, setPortfolioFilter] =
        useState<PortfolioFilter>(defaultPortfolioLifecycle)
    const [portfolioSearch, setPortfolioSearch] =
        useState("")
    const [portfolioStatusFilter, setPortfolioStatusFilter] =
        useState<PortfolioStatusFilter>("")
    const [portfolioCategoryFilter, setPortfolioCategoryFilter] =
        useState<PortfolioCategoryFilter>("")
    const [portfolioAttentionFilter, setPortfolioAttentionFilter] =
        useState<PortfolioAttentionFilter>(
            () => getInitialPortfolioAttentionFilter()
        )
    const [portfolioOutcomeFilter, setPortfolioOutcomeFilter] =
        useState<PortfolioOutcomeFilter>("")
    const [portfolioLearningFilter, setPortfolioLearningFilter] =
        useState<PortfolioLearningFilter>("")
    const [portfolioNotesFilter, setPortfolioNotesFilter] =
        useState<PortfolioNotesFilter>("")
    const [portfolioReviewFilter, setPortfolioReviewFilter] =
        useState<PortfolioReviewFilter>("")
    const [portfolioSort, setPortfolioSort] =
        useState<PortfolioSort>(
            () => getInitialPortfolioAttentionFilter()
                ? "review_asc"
                : defaultDecisionSort
        )
    const [debouncedPortfolioSearch, setDebouncedPortfolioSearch] =
        useState("")
    const [hasMorePortfolioDecisions, setHasMorePortfolioDecisions] =
        useState(false)
    const [portfolioLoading, setPortfolioLoading] =
        useState(false)
    const [portfolioInitialLoading, setPortfolioInitialLoading] =
        useState(false)
    const [portfolioLoadError, setPortfolioLoadError] =
        useState("")
    const [portfolioPaginationError, setPortfolioPaginationError] =
        useState("")
    const [portfolioRetryKey, setPortfolioRetryKey] =
        useState(0)
    const [workspaceRefreshing, setWorkspaceRefreshing] =
        useState(false)

    const portfolioSearchPending =
        portfolioSearch !== debouncedPortfolioSearch

    const portfolioFiltersActive =
        portfolioFilter !== defaultPortfolioLifecycle ||
        Boolean(portfolioCategoryFilter) ||
        Boolean(portfolioAttentionFilter) ||
        Boolean(portfolioOutcomeFilter) ||
        Boolean(portfolioLearningFilter) ||
        Boolean(portfolioNotesFilter) ||
        Boolean(portfolioReviewFilter) ||
        Boolean(portfolioStatusFilter) ||
        Boolean(portfolioSearch) ||
        portfolioSort !== defaultDecisionSort

    const activePortfolioFilterChips = [
        portfolioFilter !== defaultPortfolioLifecycle
            ? {
                key: "lifecycle",
                label: `Lifecycle: ${formatDecisionLabel(portfolioFilter)}`,
                onClear: () => setPortfolioFilter(defaultPortfolioLifecycle),
            }
            : null,
        portfolioStatusFilter
            ? {
                key: "status",
                label: `Status: ${formatDecisionLabel(portfolioStatusFilter)}`,
                onClear: () => setPortfolioStatusFilter(""),
            }
            : null,
        portfolioCategoryFilter
            ? {
                key: "category",
                label: `Category: ${formatDecisionLabel(portfolioCategoryFilter)}`,
                onClear: () => setPortfolioCategoryFilter(""),
            }
            : null,
        portfolioAttentionFilter
            ? {
                key: "attention",
                label: "Action: Needed",
                onClear: () => setPortfolioAttentionFilter(""),
            }
            : null,
        portfolioOutcomeFilter
            ? {
                key: "outcome",
                label: `Outcome: ${formatDecisionLabel(portfolioOutcomeFilter)}`,
                onClear: () => setPortfolioOutcomeFilter(""),
            }
            : null,
        portfolioLearningFilter
            ? {
                key: "learning",
                label: `Learning: ${formatDecisionLabel(portfolioLearningFilter)}`,
                onClear: () => setPortfolioLearningFilter(""),
            }
            : null,
        portfolioNotesFilter
            ? {
                key: "notes",
                label: `Notes: ${formatDecisionLabel(portfolioNotesFilter)}`,
                onClear: () => setPortfolioNotesFilter(""),
            }
            : null,
        portfolioReviewFilter
            ? {
                key: "review",
                label: `Review: ${formatDecisionLabel(portfolioReviewFilter)}`,
                onClear: () => setPortfolioReviewFilter(""),
            }
            : null,
        portfolioSearch
            ? {
                key: "search",
                label: `Search: ${portfolioSearch}`,
                onClear: () => setPortfolioSearch(""),
            }
            : null,
        portfolioSort !== defaultDecisionSort
            ? {
                key: "sort",
                label: `Sort: ${getPortfolioSortLabel(portfolioSort)}`,
                onClear: () => setPortfolioSort(defaultDecisionSort),
            }
            : null,
    ].filter(isActivePortfolioFilterChip)

    /* =========================
       Decision Workspace Manual Refresh For Summary Activity And Portfolio
    ========================= */

    async function handleRefreshDecisionWorkspace() {
        if (!user?.id || workspaceRefreshing) return

        setWorkspaceRefreshing(true)

        const userId = user.id

        try {
            const [
                summaryResult,
                activityResult,
                portfolioResult,
            ] = await Promise.allSettled([
                getDecisionSummary(
                    userId,
                    activeWorkspaceId
                ),
                getDecisionActivityFeed(
                    userId,
                    activeWorkspaceId,
                    activityFeedPageSize,
                    0
                ),
                getDecisions(
                    userId,
                    activeWorkspaceId,
                    {
                        lifecycle: portfolioFilter,
                        status: portfolioStatusFilter || undefined,
                        category: portfolioCategoryFilter || undefined,
                        attentionState: portfolioAttentionFilter || undefined,
                        outcomeState: portfolioOutcomeFilter || undefined,
                        learningState: portfolioLearningFilter || undefined,
                        notesState: portfolioNotesFilter || undefined,
                        reviewState: portfolioReviewFilter || undefined,
                        search: debouncedPortfolioSearch,
                        sort: portfolioSort,
                        limit: portfolioPageSize,
                        offset: 0,
                    }
                ),
            ])

            if (summaryResult.status === "fulfilled") {
                setDecisionSummary(summaryResult.value)
            }

            if (activityResult.status === "fulfilled") {
                setDecisionActivityFeed(activityResult.value)
                setHasMoreDecisionActivity(
                    activityResult.value.length === activityFeedPageSize
                )
                setDecisionActivityError("")
            } else {
                setHasMoreDecisionActivity(false)
                setDecisionActivityError(
                    getDecisionPageErrorMessage(
                        activityResult.reason,
                        "Decision activity could not be loaded."
                    )
                )
            }

            if (portfolioResult.status === "fulfilled") {
                setDecisions(portfolioResult.value)
                setHasMorePortfolioDecisions(
                    portfolioResult.value.length === portfolioPageSize
                )
            }
        } catch (error) {
            console.error(error)
        } finally {
            setWorkspaceRefreshing(false)
        }
    }

    useEffect(() => {
        if (!user?.id) return
        const userId = user.id
        portfolioLoadedOnce.current = false

        async function loadWorkspaceDecisionContext() {
            try {
                const summaryData =
                    await getDecisionSummary(
                        userId,
                        activeWorkspaceId
                    )
                setDecisionSummary(summaryData)
            } catch (error) {
                console.error(error)
                setDecisionSummary(null)
            }

            try {
                const activityData =
                    await getDecisionActivityFeed(
                        userId,
                        activeWorkspaceId,
                        activityFeedPageSize,
                        0
                    )
                setDecisionActivityFeed(activityData)
                setHasMoreDecisionActivity(
                    activityData.length === activityFeedPageSize
                )
                setDecisionActivityError("")
            } catch (error) {
                console.error(error)
                setDecisionActivityFeed([])
                setHasMoreDecisionActivity(false)
                setDecisionActivityError(
                    getDecisionPageErrorMessage(
                        error,
                        "Decision activity could not be loaded."
                    )
                )
            }
        }

        loadWorkspaceDecisionContext()
    }, [
        activeWorkspaceId,
        user?.id,
        workspaceVersion,
    ])

    /* =========================
       Decision Portfolio Search Debounce Before Server Query
    ========================= */

    useEffect(() => {
        const timeout =
            window.setTimeout(() => {
                setDebouncedPortfolioSearch(portfolioSearch)
            }, 300)

        return () => {
            window.clearTimeout(timeout)
        }
    }, [portfolioSearch])

    useEffect(() => {
        if (!user?.id) return
        const userId = user.id
        let cancelled = false

        async function loadPortfolioDecisions() {
            setPortfolioLoading(true)

            if (!portfolioLoadedOnce.current) {
                setPortfolioInitialLoading(true)
            }

            try {
                setPortfolioLoadError("")
                setPortfolioPaginationError("")
                const decisionData =
                    await getDecisions(
                        userId,
                        activeWorkspaceId,
                        {
                            lifecycle: portfolioFilter,
                            status: portfolioStatusFilter || undefined,
                            category: portfolioCategoryFilter || undefined,
                            attentionState: portfolioAttentionFilter || undefined,
                            outcomeState: portfolioOutcomeFilter || undefined,
                            learningState: portfolioLearningFilter || undefined,
                            notesState: portfolioNotesFilter || undefined,
                            reviewState: portfolioReviewFilter || undefined,
                            search: debouncedPortfolioSearch,
                            sort: portfolioSort,
                            limit: portfolioPageSize,
                            offset: 0,
                        }
                    )

                if (cancelled) return

                setDecisions(decisionData)
                setHasMorePortfolioDecisions(
                    decisionData.length === portfolioPageSize
                )
            } catch (error) {
                console.error(error)

                if (!cancelled) {
                    setDecisions([])
                    setHasMorePortfolioDecisions(false)
                    setPortfolioLoadError(
                        error instanceof Error
                            ? error.message
                            : "Decision portfolio could not be loaded."
                    )
                }
            } finally {
                if (!cancelled) {
                    portfolioLoadedOnce.current = true
                    setPortfolioLoading(false)
                    setPortfolioInitialLoading(false)
                }
            }
        }

        void loadPortfolioDecisions()

        return () => {
            cancelled = true
        }
    }, [
        debouncedPortfolioSearch,
        portfolioAttentionFilter,
        portfolioCategoryFilter,
        portfolioFilter,
        portfolioLearningFilter,
        portfolioNotesFilter,
        portfolioOutcomeFilter,
        portfolioReviewFilter,
        portfolioRetryKey,
        portfolioSort,
        portfolioStatusFilter,
        activeWorkspaceId,
        user?.id,
        workspaceVersion,
    ])

    async function handleLoadMoreDecisions() {
        if (!user?.id || portfolioLoading) return

        setPortfolioLoading(true)

        try {
            const decisionData =
                await getDecisions(
                    user.id,
                    activeWorkspaceId,
                    {
                        lifecycle: portfolioFilter,
                        status: portfolioStatusFilter || undefined,
                        category: portfolioCategoryFilter || undefined,
                        attentionState: portfolioAttentionFilter || undefined,
                        outcomeState: portfolioOutcomeFilter || undefined,
                        learningState: portfolioLearningFilter || undefined,
                        notesState: portfolioNotesFilter || undefined,
                        reviewState: portfolioReviewFilter || undefined,
                        search: debouncedPortfolioSearch,
                        sort: portfolioSort,
                        limit: portfolioPageSize,
                        offset: decisions.length,
                    }
                )

            setDecisions([
                ...decisions,
                ...decisionData,
            ])

            setHasMorePortfolioDecisions(
                decisionData.length === portfolioPageSize
            )
            setPortfolioPaginationError("")
        } catch (error) {
            console.error(error)
            setPortfolioPaginationError(
                getDecisionPageErrorMessage(
                    error,
                    "More decisions could not be loaded."
                )
            )
        } finally {
            setPortfolioLoading(false)
        }
    }

    /* =========================
       Decision Activity Feed Pagination For Scrollable Workspace History
    ========================= */

    async function handleLoadMoreDecisionActivity() {
        if (
            !user?.id ||
            decisionActivityLoading
        ) {
            return
        }

        setDecisionActivityLoading(true)
        setDecisionActivityError("")

        try {
            const activityData =
                await getDecisionActivityFeed(
                    user.id,
                    activeWorkspaceId,
                    activityFeedPageSize,
                    decisionActivityFeed.length
                )

            setDecisionActivityFeed([
                ...decisionActivityFeed,
                ...activityData,
            ])

            setHasMoreDecisionActivity(
                activityData.length === activityFeedPageSize
            )
            setDecisionActivityError("")
        } catch (error) {
            console.error(error)
            setDecisionActivityError(
                getDecisionPageErrorMessage(
                    error,
                    "More decision activity could not be loaded."
                )
            )
        } finally {
            setDecisionActivityLoading(false)
        }
    }

    const outcomeCounts =
        Object.fromEntries(
            decisionOutcomeStatusOptions.map(option => [
                option.value,
                getSummaryCount(
                    decisionSummary,
                    "by_outcome_status",
                    option.value,
                    decisions.filter(
                        decision => decision.outcome_status === option.value
                    ).length
                ),
            ])
        ) as Record<DecisionOutcomeStatus, number>

    const successfulCount =
        outcomeCounts.successful

    const partiallySuccessfulCount =
        outcomeCounts.partially_successful

    const unsuccessfulCount =
        outcomeCounts.unsuccessful

    const evaluatedCount =
        decisionSummary?.outcomes_evaluated ??
        (
            successfulCount +
            partiallySuccessfulCount +
            unsuccessfulCount
        )

    const successRate =
        evaluatedCount === 0
            ? 0
            : Math.round((successfulCount / evaluatedCount) * 100)

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const overdueReviewCount =
        decisionSummary?.reviews_overdue ??
        decisions.filter(
            decision => {
                if (decision.status === archivedDecisionStatus) {
                    return false
                }

                const reviewDate =
                    getDecisionDateValue(decision.review_date)

                return Boolean(reviewDate && reviewDate < today)
            }
        ).length

    const upcomingReviewCount =
        decisionSummary?.reviews_upcoming ??
        decisions.filter(
            decision => {
                if (decision.status === archivedDecisionStatus) {
                    return false
                }

                const reviewDate =
                    getDecisionDateValue(decision.review_date)

                return Boolean(reviewDate && reviewDate >= today)
            }
        ).length

    const categoryChartData = decisionCategoryOptions
        .map(({ label, value }) => ({
            name: label,
            value: getSummaryCount(
                decisionSummary,
                "by_category",
                value,
                decisions.filter(d => d.category === value).length
            ),
        }))
        .filter(item => item.value > 0)
        .sort((a, b) => b.value - a.value)

    const categoryColors = [
        "#2563eb",
        "#16a34a",
        "#f97316",
        "#9333ea",
        "#dc2626",
        "#0891b2",
        "#ca8a04",
    ]

    const monthlyDecisionCounts = decisions.reduce(
        (acc: Record<string, number>, decision) => {
            const createdAt =
                getDecisionDateValue(decision.created_at)

            if (!createdAt) return acc

            const month = createdAt.toLocaleString(
                "default",
                { month: "short" }
            )

            acc[month] = (acc[month] || 0) + 1

            return acc
        },
        {}
    )

    const monthlyDecisionData =
        decisionSummary
            ? Object.entries(decisionSummary.by_created_month)
                .map(([month, value]) => ({
                    month: formatSummaryMonth(month),
                    value,
                }))
            : Object.entries(monthlyDecisionCounts)
                .map(([month, value]) => ({
                    month,
                    value,
                }))

    const monthlyDecisionTotal =
        monthlyDecisionData.reduce(
            (total, item) => total + item.value,
            0
        )

    function getSuccessRateStyle(rate: number) {
        if (rate >= 80) return "bg-green-50 text-green-600"
        if (rate >= 60) return "bg-blue-50 text-blue-600"
        if (rate >= 40) return "bg-amber-50 text-amber-600"
        return "bg-red-50 text-red-600"
    }

    const outcomePlannedCount =
        decisionSummary?.outcomes_planned ??
        decisions.filter(
            hasPlannedOutcome
        ).length

    const outcomePendingCount =
        decisionSummary?.outcomes_pending ??
        decisions.filter(
            hasPendingOutcome
        ).length

    const outcomeRecordedCount =
        decisionSummary?.outcomes_recorded ??
        decisions.filter(
            hasRecordedOutcome
            ).length

    const learningCapturedCount =
        decisionSummary?.learning_captured ??
        decisions.filter(
            hasCapturedLearning
        ).length

    const learningPendingCount =
        decisionSummary?.learning_pending ??
        decisions.filter(
            hasPendingLearning
        ).length

    const reviewScheduledCount =
        decisionSummary?.reviews_scheduled ??
        decisions.filter(
            decision =>
                decision.status !== archivedDecisionStatus &&
                decision.review_date
        ).length

    const notesAddedCount =
        decisionSummary?.notes_added ??
        decisions.filter(
            hasAddedNotes
        ).length

    const notesPendingCount =
        decisionSummary?.notes_pending ??
        decisions.filter(
            hasPendingNotes
        ).length

    const attentionRequiredCount =
        decisionSummary?.attention_required ??
        decisions.filter(
            decision => {
                const reviewDate =
                    getDecisionDateValue(decision.review_date)
                const hasOverdueReview =
                    decision.status !== archivedDecisionStatus &&
                    Boolean(reviewDate && reviewDate < today)

                return (
                    hasPendingOutcome(decision) ||
                    hasPendingLearning(decision) ||
                    hasOverdueReview
                )
            }
        ).length

    /* =========================
       Decision Portfolio Filter Search And Summary Count State
    ========================= */

    const decisionTotalCount =
        decisionSummary?.total ?? decisions.length

    const activeDecisionCount =
        decisionSummary?.active ??
        decisions.filter(
            decision => decision.status !== archivedDecisionStatus
        ).length

    const archivedDecisionCount =
        decisionSummary?.archived ??
        decisions.filter(
            decision => decision.status === archivedDecisionStatus
        ).length
    const actionNeededView =
        portfolioAttentionFilter === "required"
    const portfolioEmptyTitle =
        actionNeededView
            ? portfolioSearch
                ? "No action-needed decisions match"
                : "No action needed"
            : "No decisions in this view"
    const portfolioEmptyDescription =
        actionNeededView
            ? portfolioSearch
                ? "Clear the search or adjust filters to review the rest of the action queue."
                : "Pending outcomes, learning follow-ups and overdue reviews are clear."
            : "Adjust the filter or search to review the rest of your decision portfolio."
    const portfolioEmptyResetLabel =
        actionNeededView && !portfolioSearch
            ? "View active decisions"
            : "Reset filters"

    const portfolioFilters: {
        key: PortfolioFilter
        label: string
        count: number
    }[] = [
        {
            key: defaultPortfolioLifecycle,
            label: "Active",
            count: activeDecisionCount,
        },
        {
            key: archivedPortfolioLifecycle,
            label: "Archived",
            count: archivedDecisionCount,
        },
        {
            key: allPortfolioLifecycle,
            label: "All",
            count: decisionTotalCount,
        },
    ]

    function resetPortfolioFilters() {
        setPortfolioFilter(defaultPortfolioLifecycle)
        setPortfolioStatusFilter("")
        setPortfolioCategoryFilter("")
        setPortfolioAttentionFilter("")
        setPortfolioOutcomeFilter("")
        setPortfolioLearningFilter("")
        setPortfolioNotesFilter("")
        setPortfolioReviewFilter("")
        setPortfolioSort(defaultDecisionSort)
        setPortfolioSearch("")
    }

    function showAttentionRequiredDecisions() {
        setPortfolioFilter(defaultPortfolioLifecycle)
        setPortfolioStatusFilter("")
        setPortfolioCategoryFilter("")
        setPortfolioAttentionFilter("required")
        setPortfolioOutcomeFilter("")
        setPortfolioLearningFilter("")
        setPortfolioNotesFilter("")
        setPortfolioReviewFilter("")
        setPortfolioSort("review_asc")
        setPortfolioSearch("")

        document
            .getElementById("decision-portfolio")
            ?.scrollIntoView({
                behavior: "smooth",
                block: "start",
            })
    }

    function showOutcomeWorkflowDecisions(
        outcomeState: DecisionOutcomeWorkflowState
    ) {
        setPortfolioFilter(allPortfolioLifecycle)
        setPortfolioStatusFilter("")
        setPortfolioCategoryFilter("")
        setPortfolioAttentionFilter("")
        setPortfolioOutcomeFilter(outcomeState)
        setPortfolioLearningFilter("")
        setPortfolioNotesFilter("")
        setPortfolioReviewFilter("")
        setPortfolioSearch("")

        document
            .getElementById("decision-portfolio")
            ?.scrollIntoView({
                behavior: "smooth",
                block: "start",
            })
    }

    function showLearningWorkflowDecisions(
        learningState: DecisionLearningWorkflowState
    ) {
        setPortfolioFilter(
            learningState === "captured"
                ? allPortfolioLifecycle
                : defaultPortfolioLifecycle
        )
        setPortfolioStatusFilter("")
        setPortfolioCategoryFilter("")
        setPortfolioAttentionFilter("")
        setPortfolioOutcomeFilter("")
        setPortfolioLearningFilter(learningState)
        setPortfolioNotesFilter("")
        setPortfolioReviewFilter("")
        setPortfolioSearch("")

        document
            .getElementById("decision-portfolio")
            ?.scrollIntoView({
                behavior: "smooth",
                block: "start",
            })
    }

    function showNotesWorkflowDecisions(
        notesState: DecisionNotesWorkflowState
    ) {
        setPortfolioFilter(
            notesState === "added"
                ? allPortfolioLifecycle
                : defaultPortfolioLifecycle
        )
        setPortfolioStatusFilter("")
        setPortfolioCategoryFilter("")
        setPortfolioAttentionFilter("")
        setPortfolioOutcomeFilter("")
        setPortfolioLearningFilter("")
        setPortfolioNotesFilter(notesState)
        setPortfolioReviewFilter("")
        setPortfolioSearch("")

        document
            .getElementById("decision-portfolio")
            ?.scrollIntoView({
                behavior: "smooth",
                block: "start",
            })
    }

    function showReviewWorkflowDecisions(
        reviewState: DecisionReviewWorkflowState
    ) {
        setPortfolioFilter(defaultPortfolioLifecycle)
        setPortfolioStatusFilter("")
        setPortfolioCategoryFilter("")
        setPortfolioAttentionFilter("")
        setPortfolioOutcomeFilter("")
        setPortfolioLearningFilter("")
        setPortfolioNotesFilter("")
        setPortfolioReviewFilter(reviewState)
        setPortfolioSort("review_asc")
        setPortfolioSearch("")

        document
            .getElementById("decision-portfolio")
            ?.scrollIntoView({
                behavior: "smooth",
                block: "start",
            })
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h1 className="text-3xl font-bold">
                        Decisions
                    </h1>

                    <p className="mt-2 text-gray-500">
                        Track decisions, review outcomes, and learn what works.
                    </p>
                </div>

                <Link
                    href="/dashboard/decisions/new?returnTo=%2Fdashboard%2Fdecisions"
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition hover:bg-blue-700"
                >
                    <Plus size={16} />
                    New Decision
                </Link>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
                <DashboardCard>
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
                                Decision Success Rate
                            </p>

                            <p className="mt-2 text-6xl font-bold tracking-tight">
                                {successRate}%
                            </p>

                            <div className="mt-4 h-2 overflow-hidden rounded-full bg-gray-100">
                                <div
                                    className={`h-full rounded-full ${successRate >= 80
                                        ? "bg-green-500"
                                        : successRate >= 60
                                            ? "bg-blue-500"
                                            : successRate >= 40
                                                ? "bg-amber-500"
                                                : "bg-red-500"
                                        }`}
                                    style={{ width: `${successRate}%` }}
                                />
                            </div>

                            <p className="mt-2 text-sm text-gray-500">
                                Based on decisions with recorded outcomes.
                            </p>
                        </div>

                        <IconBadge
                            className={getSuccessRateStyle(successRate)}
                            icon={<Target size={22} />}
                        />
                    </div>
                </DashboardCard>

                <DashboardCard>
                    <CardHeader
                        title="Decisions by Category"
                        description="Decisions grouped by business area."
                        icon={
                            <IconBadge
                                className="bg-purple-50 text-purple-600"
                                icon={<BarChart3 size={22} />}
                            />
                        }
                    />

                    {categoryChartData.length === 0 ? (
                        <EmptyState
                            title="No category data yet"
                            description="Categories will appear when decisions are created."
                        />
                    ) : (
                        <div className="mt-4 h-36">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart
                                    data={categoryChartData}
                                    layout="vertical"
                                >
                                    <XAxis type="number" allowDecimals={false} />
                                    <YAxis
                                        type="category"
                                        dataKey="name"
                                        width={90}
                                    />
                                    <Tooltip />

                                    <Bar
                                        dataKey="value"
                                        radius={[0, 6, 6, 0]}
                                    >
                                        <LabelList
                                            dataKey="value"
                                            position="right"
                                        />

                                        {categoryChartData.map((entry, index) => (
                                            <Cell
                                                key={`cell-${entry.name}`}
                                                fill={
                                                    categoryColors[
                                                    index % categoryColors.length
                                                    ]
                                                }
                                            />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </DashboardCard>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
                <DashboardCard className="h-full">
                    <CardHeader
                        title="Decision Metrics"
                        description="Snapshot of decision activity and outcomes."
                        icon={
                            <IconBadge
                                className="bg-indigo-50 text-indigo-600"
                                icon={<Gauge size={22} />}
                            />
                        }
                    />

                    <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
                        <MetricCard label="Total Decisions" value={decisionTotalCount} />
                        <MetricCard label="Evaluated" value={evaluatedCount} />
                        <MetricCard label="Upcoming Reviews" value={upcomingReviewCount} />
                        <MetricCard label="Overdue Reviews" value={overdueReviewCount} />
                        {activeDecisionStatusOptions.map(option => (
                            <MetricCard
                                key={option.value}
                                label={option.label}
                                value={getSummaryCount(
                                    decisionSummary,
                                    "by_status",
                                    option.value,
                                    decisions.filter(
                                        decision => decision.status === option.value
                                    ).length
                                )}
                            />
                        ))}
                    </div>
                </DashboardCard>

                <DashboardCard>
                    <CardHeader
                        title="Monthly Decision Trend"
                        description="Decision creation activity over time."
                        icon={
                            <IconBadge
                                className="bg-blue-50 text-blue-600"
                                icon={<TrendingUp size={22} />}
                            />
                        }
                    />

                    {monthlyDecisionData.length > 1 ? (
                        <div className="mt-4 h-40">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={monthlyDecisionData}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="month" />
                                    <YAxis allowDecimals={false} />
                                    <Tooltip />
                                    <Line
                                        type="monotone"
                                        dataKey="value"
                                        stroke="#2563eb"
                                        strokeWidth={3}
                                        dot={{ r: 4 }}
                                        activeDot={{ r: 6 }}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="mt-4 flex h-40 flex-col items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-center">
                            <p className="text-5xl font-bold text-blue-700">
                                {monthlyDecisionTotal}
                            </p>

                            <p className="mt-2 text-sm font-medium text-blue-700">
                                decisions created this month
                            </p>

                            <p className="mt-1 text-xs text-blue-500">
                                Trend chart appears when multiple months are available.
                            </p>
                        </div>
                    )}
                </DashboardCard>
            </div>

            <DashboardCard>
                <CardHeader
                    title="Decision Health"
                    description="How complete your decision records are."
                    icon={
                        <IconBadge
                            className="bg-green-50 text-green-600"
                            icon={<HeartPulse size={22} />}
                        />
                    }
                />

                <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6">
                    <MetricCard
                        label="Action Needed"
                        value={attentionRequiredCount}
                        onClick={showAttentionRequiredDecisions}
                    />

                    <MetricCard
                        label="Outcomes Planned"
                        value={outcomePlannedCount}
                        onClick={() =>
                            showOutcomeWorkflowDecisions("planned")
                        }
                    />

                    <MetricCard
                        label="Outcomes Pending"
                        value={outcomePendingCount}
                        onClick={() =>
                            showOutcomeWorkflowDecisions("pending")
                        }
                    />

                    <MetricCard
                        label="Outcomes Recorded"
                        value={outcomeRecordedCount}
                        onClick={() =>
                            showOutcomeWorkflowDecisions("recorded")
                        }
                    />

                    <MetricCard
                        label="Learning Captured"
                        value={learningCapturedCount}
                        onClick={() =>
                            showLearningWorkflowDecisions("captured")
                        }
                    />

                    <MetricCard
                        label="Learning Pending"
                        value={learningPendingCount}
                        onClick={() =>
                            showLearningWorkflowDecisions("pending")
                        }
                    />

                    <MetricCard
                        label="Reviews Overdue"
                        value={overdueReviewCount}
                        onClick={() =>
                            showReviewWorkflowDecisions("overdue")
                        }
                    />

                    <MetricCard
                        label="Reviews Upcoming"
                        value={upcomingReviewCount}
                        onClick={() =>
                            showReviewWorkflowDecisions("upcoming")
                        }
                    />

                    <MetricCard
                        label="Reviews Scheduled"
                        value={reviewScheduledCount}
                        onClick={() =>
                            showReviewWorkflowDecisions("scheduled")
                        }
                    />

                    <MetricCard
                        label="Notes Added"
                        value={notesAddedCount}
                        onClick={() =>
                            showNotesWorkflowDecisions("added")
                        }
                    />

                    <MetricCard
                        label="Notes Pending"
                        value={notesPendingCount}
                        onClick={() =>
                            showNotesWorkflowDecisions("pending")
                        }
                    />
                </div>
            </DashboardCard>

            {/* =========================
                Workspace Recent Decision Activity Feed Section
            ========================= */}

            <DashboardCard>
                <CardHeader
                    title="Recent Decision Activity"
                    description="Latest updates across the current decision workspace."
                    action={
                        <button
                            type="button"
                            aria-label="Refresh decision workspace"
                            onClick={handleRefreshDecisionWorkspace}
                            disabled={workspaceRefreshing}
                            className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition hover:border-blue-200 hover:text-blue-700 disabled:cursor-not-allowed disabled:text-gray-300"
                        >
                            <RefreshCw
                                size={16}
                                className={
                                    workspaceRefreshing
                                        ? "animate-spin"
                                        : ""
                                }
                            />
                        </button>
                    }
                    icon={
                        <IconBadge
                            className="bg-gray-100 text-gray-600"
                            icon={<Activity size={22} />}
                        />
                    }
                />

                {decisionActivityError && (
                    <div className="mt-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                        {decisionActivityError}
                    </div>
                )}

                {decisionActivityFeed.length === 0 ? (
                    <EmptyState
                        title="No activity yet"
                        description="Decision updates will appear here as work happens."
                    />
                ) : (
                    <div className="mt-4 max-h-72 overflow-y-auto pr-2 divide-y divide-gray-100">
                        {decisionActivityFeed.map(activityItem => (
                            <DecisionActivityRow
                                key={activityItem.id}
                                activityItem={activityItem}
                            />
                        ))}

                        {hasMoreDecisionActivity && (
                            <div className="pt-3">
                                <button
                                    type="button"
                                    onClick={handleLoadMoreDecisionActivity}
                                    disabled={decisionActivityLoading}
                                    className="inline-flex h-9 items-center justify-center rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-600 transition hover:border-blue-200 hover:text-blue-700 disabled:cursor-not-allowed disabled:text-gray-300"
                                >
                                    {decisionActivityLoading
                                        ? "Loading activity..."
                                        : "Load more activity"}
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </DashboardCard>

            <div id="decision-portfolio" className="scroll-mt-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-2xl font-semibold">
                            Decision Portfolio
                        </h2>
                    </div>

                    <IconBadge
                        className="bg-purple-50 text-purple-600"
                        icon={<BriefcaseBusiness size={22} />}
                    />
                </div>

                {/* =========================
                    Decision Portfolio Controls For Lifecycle Filter And Search
                ========================= */}

                <div className="mt-4 flex flex-wrap items-center gap-3">
                    <div className="flex flex-wrap gap-2">
                        {portfolioFilters.map(filter => (
                            <button
                                key={filter.key}
                                type="button"
                                onClick={() => {
                                    setPortfolioFilter(filter.key)

                                    if (
                                        filter.key ===
                                        archivedPortfolioLifecycle
                                    ) {
                                        setPortfolioStatusFilter("")
                                    }
                                }}
                                className={getPortfolioFilterClass(
                                    portfolioFilter === filter.key
                                )}
                            >
                                {filter.label}
                                <span className="ml-2 rounded-full bg-white/70 px-2 py-0.5 text-xs">
                                    {filter.count}
                                </span>
                            </button>
                        ))}
                    </div>

                    {/* =========================
                        Decision Portfolio Status Filter For Server Query
                    ========================= */}

                    <select
                        value={portfolioStatusFilter}
                        disabled={
                            portfolioFilter === archivedPortfolioLifecycle
                        }
                        onChange={(event) =>
                            setPortfolioStatusFilter(
                                event.target.value as PortfolioStatusFilter
                            )
                        }
                        className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
                    >
                        <option value="">All statuses</option>
                        {activeDecisionStatusOptions.map(option => (
                            <option
                                key={option.value}
                                value={option.value}
                            >
                                {option.label}
                            </option>
                        ))}
                    </select>

                    {/* =========================
                        Decision Portfolio Category Filter For Server Query
                    ========================= */}

                    <select
                        value={portfolioCategoryFilter}
                        onChange={(event) =>
                            setPortfolioCategoryFilter(
                                event.target.value as PortfolioCategoryFilter
                            )
                        }
                        className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    >
                        <option value="">All categories</option>
                        {decisionCategoryOptions.map(option => (
                            <option
                                key={option.value}
                                value={option.value}
                            >
                                {option.label}
                            </option>
                        ))}
                    </select>

                    {/* =========================
                        Decision Portfolio Attention Filter For Aggregate Follow-Up Work
                    ========================= */}

                    <select
                        value={portfolioAttentionFilter}
                        onChange={(event) => {
                            const attentionState =
                                event.target.value as PortfolioAttentionFilter

                            setPortfolioAttentionFilter(attentionState)

                            if (attentionState) {
                                setPortfolioOutcomeFilter("")
                                setPortfolioLearningFilter("")
                                setPortfolioNotesFilter("")
                                setPortfolioReviewFilter("")
                            }
                        }}
                        className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    >
                        <option value="">All action states</option>
                        <option value="required">Action needed</option>
                    </select>

                    {/* =========================
                        Decision Portfolio Outcome Workflow Filter For Server Query
                    ========================= */}

                    <select
                        value={portfolioOutcomeFilter}
                        onChange={(event) => {
                            setPortfolioAttentionFilter("")
                            setPortfolioOutcomeFilter(
                                event.target.value as PortfolioOutcomeFilter
                            )
                        }}
                        className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    >
                        <option value="">All outcome work</option>
                        <option value="planned">Outcome planned</option>
                        <option value="pending">Outcome pending</option>
                        <option value="recorded">Outcome recorded</option>
                        <option value="evaluated">Outcome evaluated</option>
                    </select>

                    {/* =========================
                        Decision Portfolio Learning Workflow Filter For Server Query
                    ========================= */}

                    <select
                        value={portfolioLearningFilter}
                        onChange={(event) => {
                            setPortfolioAttentionFilter("")
                            setPortfolioLearningFilter(
                                event.target.value as PortfolioLearningFilter
                            )
                        }}
                        className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    >
                        <option value="">All learning work</option>
                        <option value="captured">Learning captured</option>
                        <option value="pending">Learning pending</option>
                    </select>

                    {/* =========================
                        Decision Portfolio Notes Workflow Filter For Server Query
                    ========================= */}

                    <select
                        value={portfolioNotesFilter}
                        onChange={(event) => {
                            setPortfolioAttentionFilter("")
                            setPortfolioNotesFilter(
                                event.target.value as PortfolioNotesFilter
                            )
                        }}
                        className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    >
                        <option value="">All note work</option>
                        <option value="added">Notes added</option>
                        <option value="pending">Notes pending</option>
                    </select>

                    {/* =========================
                        Decision Portfolio Review Workflow Filter For Server Query
                    ========================= */}

                    <select
                        value={portfolioReviewFilter}
                        onChange={(event) => {
                            setPortfolioAttentionFilter("")
                            setPortfolioReviewFilter(
                                event.target.value as PortfolioReviewFilter
                            )
                        }}
                        className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    >
                        <option value="">All review work</option>
                        <option value="scheduled">Review scheduled</option>
                        <option value="overdue">Review overdue</option>
                        <option value="upcoming">Review upcoming</option>
                    </select>

                    {/* =========================
                        Decision Portfolio Sort Control For Server Ordering
                    ========================= */}

                    <select
                        value={portfolioSort}
                        onChange={(event) =>
                            setPortfolioSort(
                                event.target.value as PortfolioSort
                            )
                        }
                        className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    >
                        {decisionSortOptions.map(option => (
                            <option
                                key={option.value}
                                value={option.value}
                            >
                                {option.label}
                            </option>
                        ))}
                    </select>

                    {/* =========================
                        Decision Portfolio Search Input For Visible Cards
                    ========================= */}

                    <div className="relative w-full sm:w-72">
                        <Search
                            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                            size={16}
                        />

                        <input
                            value={portfolioSearch}
                            onChange={(event) =>
                                setPortfolioSearch(event.target.value)
                            }
                            placeholder="Search decisions"
                            className="h-10 w-full rounded-lg border border-gray-200 pl-9 pr-9 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />

                        {portfolioSearch && (
                            <button
                                type="button"
                                aria-label="Clear decision search"
                                onClick={() => setPortfolioSearch("")}
                                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>

                    {(portfolioSearchPending || portfolioLoading) && (
                        <p className="text-sm text-gray-500">
                            {portfolioSearchPending
                                ? "Preparing search..."
                                : "Loading decisions..."}
                        </p>
                    )}

                    {portfolioFiltersActive && (
                        <button
                            type="button"
                            onClick={resetPortfolioFilters}
                            className="h-10 rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-600 transition hover:border-blue-200 hover:text-blue-700"
                        >
                            Reset filters
                        </button>
                    )}
                </div>

                {portfolioFiltersActive && (
                    /* =========================
                        Decision Portfolio Active Filter Summary Row
                    ========================= */

                    <div className="mt-3 flex flex-wrap gap-2">
                        {activePortfolioFilterChips.map(chip => (
                            <button
                                key={chip.key}
                                type="button"
                                onClick={chip.onClear}
                                className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-600 transition hover:border-blue-200 hover:text-blue-700"
                            >
                                {chip.label}
                                <X size={12} />
                            </button>
                        ))}
                    </div>
                )}

                <div className="mt-4 h-px bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200" />
            </div>

            {portfolioInitialLoading ? (
                <DashboardCard className="border-dashed text-center">
                    <p className="text-sm font-medium text-gray-600">
                        Loading decision portfolio...
                    </p>
                </DashboardCard>
            ) : portfolioLoadError ? (
                <DashboardCard className="border-dashed text-center">
                    <h3 className="text-lg font-semibold text-red-600">
                        Decision portfolio could not load
                    </h3>

                    <p className="mt-2 text-sm text-gray-500">
                        {portfolioLoadError}
                    </p>

                    <button
                        type="button"
                        onClick={() => {
                            portfolioLoadedOnce.current = false
                            setPortfolioLoadError("")
                            setPortfolioRetryKey(
                                currentKey => currentKey + 1
                            )
                        }}
                        className="mt-4 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition hover:border-blue-200 hover:text-blue-700"
                    >
                        Retry
                    </button>
                </DashboardCard>
            ) : decisionTotalCount === 0 ? (
                <DashboardCard className="border-dashed text-center">
                    <h3 className="text-lg font-semibold">
                        No decisions yet
                    </h3>

                    <p className="mt-2 text-sm text-gray-500">
                        Create your first decision to start tracking outcomes and learning what works.
                    </p>
                </DashboardCard>
            ) : decisions.length === 0 ? (
                <DashboardCard className="border-dashed text-center">
                    <h3 className="text-lg font-semibold">
                        {portfolioEmptyTitle}
                    </h3>

                    <p className="mt-2 text-sm text-gray-500">
                        {portfolioEmptyDescription}
                    </p>

                    {portfolioFiltersActive && (
                        <button
                            type="button"
                            onClick={resetPortfolioFilters}
                            className="mt-4 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition hover:border-blue-200 hover:text-blue-700"
                        >
                            {portfolioEmptyResetLabel}
                        </button>
                    )}
                </DashboardCard>
            ) : (
                /* =========================
                    Decision Portfolio Scrollable Card Grid For Large Workspaces
                ========================= */

                <div className="max-h-[42rem] overflow-y-auto pr-2">
                    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                        {decisions.map(decision => (
                            <DecisionCard
                                key={decision.id}
                                decision={decision}
                            />
                        ))}
                    </div>

                    {portfolioPaginationError && (
                        <div className="mt-5 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                            {portfolioPaginationError}
                        </div>
                    )}

                    {hasMorePortfolioDecisions && (
                        <div className="sticky bottom-0 mt-5 bg-white/95 py-3 text-center backdrop-blur">
                            <button
                                type="button"
                                onClick={handleLoadMoreDecisions}
                                disabled={portfolioLoading}
                                className={getLoadMoreButtonClass(
                                    portfolioLoading
                                )}
                            >
                                {portfolioLoading
                                    ? "Loading..."
                                    : "Load More Decisions"}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
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

function CardHeader({
    title,
    description,
    action,
    icon,
}: {
    title: string
    description: string
    action?: React.ReactNode
    icon: React.ReactNode
}) {
    return (
        <div className="flex items-start justify-between gap-4">
            <div>
                <h2 className="text-xl font-semibold tracking-tight">
                    {title}
                </h2>

                <p className="mt-1 text-sm text-gray-600">
                    {description}
                </p>
            </div>

            <div className="flex items-center gap-2">
                {action}
                {icon}
            </div>
        </div>
    )
}

function IconBadge({
    icon,
    className,
}: {
    icon: React.ReactNode
    className: string
}) {
    return (
        <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${className}`}
        >
            {icon}
        </div>
    )
}

function MetricCard({
    label,
    value,
    suffix = "",
    onClick,
}: {
    label: string
    value: number
    suffix?: string
    onClick?: () => void
}) {
    const className =
        "w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-left" +
        (onClick
            ? " transition hover:border-blue-200 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-100"
            : "")

    const content = (
        <>
            <p className="truncate text-xs font-medium text-gray-500">
                {label}
            </p>

            <p className="mt-1 text-xl font-semibold text-gray-900">
                {value}{suffix}
            </p>
        </>
    )

    return onClick ? (
        <button
            type="button"
            onClick={onClick}
            className={className}
            aria-label={`Show ${label.toLowerCase()} decisions`}
        >
            {content}
        </button>
    ) : (
        <div className={className}>
            {content}
        </div>
    )
}

function EmptyState({
    title,
    description,
}: {
    title: string
    description: string
}) {
    return (
        <div className="mt-4 flex h-36 flex-col items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-center">
            <p className="text-sm font-medium text-blue-700">
                {title}
            </p>

            <p className="mt-1 text-xs text-blue-500">
                {description}
            </p>
        </div>
    )
}

/* =========================
   Decision Summary Count Helpers For Backend First Metrics
========================= */

function getSummaryCount(
    summary: DecisionSummary | null,
    key: DecisionSummaryCountKey,
    value: string,
    fallback: number
) {
    return summary?.[key][value] ?? fallback
}

function formatSummaryMonth(monthKey: string) {
    const [year, month] =
        monthKey.split("-")

    return new Date(
        Number(year),
        Number(month) - 1,
        1
    ).toLocaleString(
        "default",
        { month: "short" }
    )
}

/* =========================
   Decision Portfolio Filter And Search Helpers
========================= */

function getPortfolioFilterClass(active: boolean) {
    return `inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-medium transition ${
        active
            ? "border-blue-200 bg-blue-50 text-blue-700"
            : "border-gray-200 bg-white text-gray-600 hover:border-blue-200 hover:text-blue-700"
    }`
}

function getLoadMoreButtonClass(disabled: boolean) {
    return `rounded-lg border px-4 py-2 text-sm font-medium transition ${
        disabled
            ? "cursor-not-allowed border-gray-200 text-gray-400"
            : "border-blue-200 text-blue-700 hover:bg-blue-50"
    }`
}

function getPortfolioSortLabel(sort: PortfolioSort) {
    return (
        decisionSortOptions.find(
            option => option.value === sort
        )?.label ?? "Newest first"
    )
}

function isActivePortfolioFilterChip(
    chip: ActivePortfolioFilterChip | null
): chip is ActivePortfolioFilterChip {
    return chip !== null
}

/* =========================
   Workspace Recent Activity Row Component For Decision Audit Navigation
========================= */

function DecisionActivityRow({
    activityItem,
}: {
    activityItem: DecisionActivityFeedItem
}) {
    const decisionAvailable =
        activityItem.decision_available !== false

    const rowContent = (
        <>
            <span
                className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${getDecisionActivityDotClass(
                    activityItem.activity_type
                )}`}
            />

            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-gray-900">
                    {activityItem.decision_title}
                </span>

                    <span className="mt-1 block text-sm text-gray-500">
                        {activityItem.message}
                    </span>

                    {!decisionAvailable && (
                        <span className="mt-1 block text-xs font-medium text-gray-400">
                            Decision not available
                        </span>
                    )}
                </span>

            <span className="flex shrink-0 items-start gap-3">
                <span className="flex flex-col items-end gap-1">
                    <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${getDecisionActivityBadgeClass(
                            activityItem.activity_type
                        )}`}
                    >
                        {formatDecisionLabel(activityItem.activity_type)}
                    </span>

                    <span className="text-xs text-gray-400">
                        {formatActivityTimestamp(
                            activityItem.created_at
                        )}
                    </span>
                </span>

                <ArrowRight
                    className={`mt-1 transition ${
                        decisionAvailable
                            ? "text-gray-300 group-hover:text-blue-500"
                            : "text-gray-200"
                    }`}
                    size={16}
                />
            </span>
        </>
    )

    if (!decisionAvailable) {
        return (
            <div className="flex items-start gap-3 py-3 opacity-75">
                {rowContent}
            </div>
        )
    }

    return (
        <Link
            href={`/dashboard/decisions/${activityItem.decision_id}`}
            aria-label={`${activityItem.decision_title}: ${activityItem.message}`}
            className="group flex items-start gap-3 py-3 transition hover:bg-gray-50"
        >
            {rowContent}
        </Link>
    )
}

function formatActivityTimestamp(createdAt: string) {
    const createdDate =
        getDecisionDateValue(createdAt)

    if (!createdDate) {
        return "Unknown time"
    }

    return createdDate.toLocaleString(
        undefined,
        {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
        }
    )
}

/* =========================
   Decision Card Health Label And Badge Helpers
========================= */

function getDecisionHealth(
    decision: DecisionListRecord
): DecisionHealthLabel {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    if (decision.status === archivedDecisionStatus) {
        return archivedDecisionLabel
    }

    const reviewDate =
        getDecisionDateValue(decision.review_date)

    if (reviewDate && reviewDate < today) {
        return needsReviewDecisionLabel
    }

    if (
        decision.status === completedDecisionStatus &&
        hasRecordedOutcome(decision) &&
        decision.lessons_learned
    ) {
        return healthyDecisionLabel
    }

    if (decision.status === inProgressDecisionStatus) {
        return inProgressDecisionLabel
    }

    if (decision.status === cancelledDecisionStatus) {
        return cancelledDecisionLabel
    }

    return plannedDecisionLabel
}

function getDecisionFollowUpActions(
    decision: DecisionListRecord
) {
    if (decision.status === archivedDecisionStatus) {
        return []
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const reviewDate =
        getDecisionDateValue(decision.review_date)

    const actions: string[] = []

    if (reviewDate && reviewDate < today) {
        actions.push("Review overdue")
    }

    if (hasPendingOutcome(decision)) {
        actions.push("Record actual outcome")
    }

    if (hasPendingLearning(decision)) {
        actions.push("Capture learning")
    }

    return actions
}

function getHealthBadgeClass(health: DecisionHealthLabel) {
    if (health === healthyDecisionLabel) {
        return "border-green-200 bg-green-50 text-green-700"
    }

    if (health === needsReviewDecisionLabel) {
        return "border-amber-200 bg-amber-50 text-amber-700"
    }

    if (health === inProgressDecisionLabel) {
        return "border-blue-200 bg-blue-50 text-blue-700"
    }

    if (health === cancelledDecisionLabel) {
        return "border-red-200 bg-red-50 text-red-700"
    }

    if (health === archivedDecisionLabel) {
        return "border-gray-200 bg-gray-50 text-gray-600"
    }

    return "border-gray-200 bg-gray-50 text-gray-700"
}

function DecisionCard({
    decision,
}: {
    decision: DecisionListRecord
}) {
    const health = getDecisionHealth(decision)
    const isArchived =
        decision.status === archivedDecisionStatus
    const lastUpdatedLabel =
        getDecisionUpdatedLabel(decision)
    const expectedOutcome =
        decision.expected_outcome?.trim()
    const outcomePending =
        hasPendingOutcome(decision)
    const learningPending =
        hasPendingLearning(decision)
    const notesPending =
        hasPendingNotes(decision)
    const followUpActions =
        getDecisionFollowUpActions(decision)
    const decisionHref =
        followUpActions.length > 0
            ? `/dashboard/decisions/${decision.id}?focus=next-action`
            : `/dashboard/decisions/${decision.id}`

    return (
        <Link
            href={decisionHref}
            className={getDecisionCardClass(isArchived)}
        >
            <div className="flex items-start justify-between gap-4">
                <h2 className="text-lg font-semibold">
                    {decision.title}
                </h2>

                <span
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${getHealthBadgeClass(
                        health
                    )}`}
                >
                    {health}
                </span>
            </div>

            <p className="mt-3 text-sm text-gray-500 line-clamp-2">
                {decision.description ||
                    "No description provided."}
            </p>

            {expectedOutcome && (
                <p className="mt-3 border-l-2 border-green-200 pl-3 text-sm text-gray-600 line-clamp-2">
                    <span className="font-medium text-green-700">
                        Expected:
                    </span>{" "}
                    {expectedOutcome}
                </p>
            )}

            {followUpActions.length > 0 && (
                <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                        Action needed
                    </p>

                    <div className="mt-2 flex flex-wrap gap-2">
                        {followUpActions.map(action => (
                            <span
                                key={action}
                                className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-amber-700 shadow-sm"
                            >
                                {action}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            <div className="mt-4 grid grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
                {decision.category && (
                    <span className="flex min-w-0 items-center gap-1 text-blue-600">
                        <FolderOpen size={12} className="shrink-0" />
                        {formatDecisionLabel(decision.category)}
                    </span>
                )}

                {decision.review_date && (
                    <span className="flex min-w-0 items-center gap-1 text-amber-600">
                        <Calendar size={12} className="shrink-0" />
                        {formatDecisionDate(
                            decision.review_date
                        )}
                    </span>
                )}

                {decision.priority && (
                    <span className="flex min-w-0 items-center gap-1 text-red-600">
                        <Flag size={12} className="shrink-0" />
                        Priority: {formatDecisionLabel(decision.priority)}
                    </span>
                )}

                {outcomePending && (
                    <span className="flex min-w-0 items-center gap-1 text-amber-600">
                        <Target size={12} className="shrink-0" />
                        Outcome Pending
                    </span>
                )}

                {hasRecordedOutcome(decision) && (
                    <span className="flex min-w-0 items-center gap-1 text-green-600">
                        <Target size={12} className="shrink-0" />
                        {decision.outcome_status
                            ? formatDecisionLabel(decision.outcome_status)
                            : "Actual Recorded"}
                    </span>
                )}

                {learningPending && (
                    <span className="flex min-w-0 items-center gap-1 text-purple-600">
                        <Lightbulb size={12} className="shrink-0" />
                        Learning Pending
                    </span>
                )}

                {notesPending && (
                    <span className="flex min-w-0 items-center gap-1 text-gray-600">
                        <FileText size={12} className="shrink-0" />
                        Notes Pending
                    </span>
                )}

                {decision.confidence_score && (
                    <span className="flex min-w-0 items-center gap-1 text-indigo-600">
                        <Gauge size={12} className="shrink-0" />
                        Confidence: {formatDecisionLabel(decision.confidence_score)}
                    </span>
                )}

                {lastUpdatedLabel && (
                    <span className="flex min-w-0 items-center gap-1 text-gray-500">
                        <Activity size={12} className="shrink-0" />
                        {lastUpdatedLabel}
                    </span>
                )}
            </div>

            <div className="mt-4 border-t border-gray-100 pt-3">
                <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400">
                        {isArchived
                            ? "Historical record"
                            : followUpActions.length > 0
                              ? "Next action ready"
                            : "Click to manage decision"}
                    </span>

                    <span className="font-medium text-blue-600">
                        {isArchived
                            ? "View Archived Record →"
                            : followUpActions.length > 0
                              ? "Resolve Next Action →"
                            : "View Details →"}
                    </span>
                </div>
            </div>
        </Link>
    )
}

function getDecisionCardClass(
    archived: boolean
) {
    return `block rounded-2xl border p-6 shadow-sm transition hover:shadow-lg ${
        archived
            ? "border-gray-200 bg-gray-50 hover:border-gray-300"
            : "border-gray-200 bg-white hover:border-blue-200"
    }`
}

/* =========================
   Decision Card Last Updated Helper For Portfolio Sorting Context
========================= */

function getDecisionUpdatedLabel(
    decision: DecisionListRecord
) {
    const updatedDate =
        formatDecisionDate(decision.updated_at)

    if (!updatedDate) {
        return null
    }

    return `Updated ${updatedDate}`
}

function getDecisionDateValue(
    value?: string | null
) {
    if (!value) {
        return null
    }

    const date = new Date(value)

    return Number.isNaN(date.getTime())
        ? null
        : date
}

function formatDecisionDate(
    value?: string | null
) {
    return getDecisionDateValue(value)?.toLocaleDateString() ?? null
}
