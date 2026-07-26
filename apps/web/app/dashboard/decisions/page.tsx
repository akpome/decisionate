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
    defaultPortfolioLifecycle,
    defaultDecisionSort,
    decisionCategoryOptions,
    decisionSortOptions,
    formatDecisionLabel,
} from "@/lib/decision-options"
import {
    hasPendingLearning,
    hasPendingNotes,
    hasPendingOutcome,
    hasRecordedOutcome,
} from "@/lib/decision-outcomes"
import {
    archivedDecisionHealthLabel,
    cancelledDecisionHealthLabel,
    getDecisionHealth,
    healthyDecisionHealthLabel,
    inProgressDecisionHealthLabel,
    needsReviewDecisionHealthLabel,
} from "@/lib/decision-health"
import type {
    DecisionHealthLabel,
} from "@/lib/decision-health"
import type {
    ActiveDecisionStatus,
} from "@/lib/decision-options"
import {
    useActiveWorkspace,
} from "@/lib/use-active-workspace"
import {
    useWorkspaceAccess,
} from "@/lib/use-workspace-access"
import {
    WorkspaceAccessNotice,
} from "@/features/dashboard/components/workspace-access-notice"
import { DashboardPageHeader } from "@/features/dashboard/components/dashboard-page-header"
import { getAIRecommendationSource } from "@/features/decisions/lib/ai-recommendation-source"
import {
    formatMetricLabel,
} from "@/features/dashboard/components/metric-selector"
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
    Target,
    Calendar,
    Activity,
    ArrowRight,
    FolderOpen,
    Flag,
    FileText,
    Gauge,
    Lightbulb,
    LineChart as LineChartIcon,
    BriefcaseBusiness,
    Search,
    RefreshCw,
    Plus,
    Link2,
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

function getDecisionPortfolioSearchParams() {
    if (typeof window === "undefined") {
        return new URLSearchParams()
    }

    return new URLSearchParams(
        window.location.search
    )
}

function getInitialDecisionPortfolioOption<T extends string>(
    key: string,
    allowedValues: readonly T[],
    fallbackValue: T
) {
    const value =
        getDecisionPortfolioSearchParams().get(key)

    return allowedValues.includes(value as T)
        ? value as T
        : fallbackValue
}

function getInitialDecisionPortfolioText(
    key: string
) {
    return getDecisionPortfolioSearchParams()
        .get(key)
        ?.trim() ?? ""
}

const portfolioPageSize = 24
const activityFeedPageSize = 20
const addNotesFollowUpAction = "Add notes"
const decisionPortfolioLifecycleOptions = [
    allPortfolioLifecycle,
    defaultPortfolioLifecycle,
    archivedPortfolioLifecycle,
] as const
const decisionPortfolioAttentionOptions = [
    "required",
] as const
const decisionPortfolioOutcomeOptions = [
    "planned",
    "pending",
    "recorded",
    "evaluated",
] as const
const decisionPortfolioLearningOptions = [
    "captured",
    "pending",
] as const
const decisionPortfolioNotesOptions = [
    "added",
    "pending",
] as const
const decisionPortfolioReviewOptions = [
    "scheduled",
    "overdue",
    "upcoming",
] as const

export default function DecisionsPage() {
    const { user } = useUser()
    const {
        activeWorkspaceId,
        workspaceVersion,
    } =
        useActiveWorkspace(user?.id)
    const {
        canManageWorkspaceData,
        loadingWorkspaceAccess,
    } = useWorkspaceAccess(user?.id)
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
        useState<PortfolioFilter>(
            () => getInitialDecisionPortfolioOption(
                "lifecycle",
                decisionPortfolioLifecycleOptions,
                defaultPortfolioLifecycle
            )
        )
    const [portfolioSearch, setPortfolioSearch] =
        useState(
            () => getInitialDecisionPortfolioText("search")
        )
    const [portfolioStatusFilter, setPortfolioStatusFilter] =
        useState<PortfolioStatusFilter>(
            () =>
                getInitialDecisionPortfolioOption(
                    "lifecycle",
                    decisionPortfolioLifecycleOptions,
                    defaultPortfolioLifecycle
                ) === archivedPortfolioLifecycle
                    ? ""
                    : getInitialDecisionPortfolioOption(
                        "status",
                        activeDecisionStatusOptions.map(option => option.value),
                        ""
                    )
        )
    const [portfolioCategoryFilter, setPortfolioCategoryFilter] =
        useState<PortfolioCategoryFilter>(
            () => getInitialDecisionPortfolioOption(
                "category",
                decisionCategoryOptions.map(option => option.value),
                ""
            )
        )
    const [portfolioAttentionFilter, setPortfolioAttentionFilter] =
        useState<PortfolioAttentionFilter>(
            () => getInitialDecisionPortfolioOption(
                "attention",
                decisionPortfolioAttentionOptions,
                ""
            )
        )
    const [portfolioOutcomeFilter, setPortfolioOutcomeFilter] =
        useState<PortfolioOutcomeFilter>(
            () =>
                getInitialDecisionPortfolioOption(
                    "attention",
                    decisionPortfolioAttentionOptions,
                    ""
                )
                    ? ""
                    : getInitialDecisionPortfolioOption(
                        "outcome",
                        decisionPortfolioOutcomeOptions,
                        ""
                    )
        )
    const [portfolioLearningFilter, setPortfolioLearningFilter] =
        useState<PortfolioLearningFilter>(
            () =>
                getInitialDecisionPortfolioOption(
                    "attention",
                    decisionPortfolioAttentionOptions,
                    ""
                )
                    ? ""
                    : getInitialDecisionPortfolioOption(
                        "learning",
                        decisionPortfolioLearningOptions,
                        ""
                    )
        )
    const [portfolioNotesFilter, setPortfolioNotesFilter] =
        useState<PortfolioNotesFilter>(
            () =>
                getInitialDecisionPortfolioOption(
                    "attention",
                    decisionPortfolioAttentionOptions,
                    ""
                )
                    ? ""
                    : getInitialDecisionPortfolioOption(
                        "notes",
                        decisionPortfolioNotesOptions,
                        ""
                    )
        )
    const [portfolioReviewFilter, setPortfolioReviewFilter] =
        useState<PortfolioReviewFilter>(
            () =>
                getInitialDecisionPortfolioOption(
                    "attention",
                    decisionPortfolioAttentionOptions,
                    ""
                )
                    ? ""
                    : getInitialDecisionPortfolioOption(
                        "review",
                        decisionPortfolioReviewOptions,
                        ""
                    )
        )
    const [portfolioSort, setPortfolioSort] =
        useState<PortfolioSort>(
            () => getInitialDecisionPortfolioOption(
                "sort",
                decisionSortOptions.map(option => option.value),
                getInitialDecisionPortfolioOption(
                    "attention",
                    decisionPortfolioAttentionOptions,
                    ""
                )
                    ? "review_asc"
                    : defaultDecisionSort
            )
        )
    const [debouncedPortfolioSearch, setDebouncedPortfolioSearch] =
        useState(
            () => getInitialDecisionPortfolioText("search")
        )
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
    const [activityRetryKey, setActivityRetryKey] =
        useState(0)
    const [workspaceRefreshing, setWorkspaceRefreshing] =
        useState(false)
    const [portfolioLinkStatus, setPortfolioLinkStatus] =
        useState<{
            message: string
            viewKey: string
        } | null>(null)
    const refreshRequestId = useRef(0)
    const activeRefreshRequestId = useRef<number | null>(null)
    const portfolioRequestId = useRef(0)
    const activityRequestId = useRef(0)
    const decisionContextWorkspaceId = useRef<
        string | undefined
    >(undefined)
    const portfolioWorkspaceId = useRef<string | undefined>(
        undefined
    )

    const trimmedPortfolioSearch =
        portfolioSearch.trim()
    const portfolioViewKey = JSON.stringify([
        portfolioFilter,
        portfolioStatusFilter,
        portfolioCategoryFilter,
        portfolioAttentionFilter,
        portfolioOutcomeFilter,
        portfolioLearningFilter,
        portfolioNotesFilter,
        portfolioReviewFilter,
        portfolioSort,
        trimmedPortfolioSearch,
    ])

    useEffect(() => {
        if (!portfolioLinkStatus) {
            return
        }

        const timeout =
            window.setTimeout(() => {
                setPortfolioLinkStatus(null)
            }, 3000)

        return () => {
            window.clearTimeout(timeout)
        }
    }, [portfolioLinkStatus])

    useEffect(() => {
        if (typeof window === "undefined") {
            return
        }

        const url =
            new URL(window.location.href)

        const setPortfolioParam = (
            key: string,
            value: string,
            defaultValue = ""
        ) => {
            if (value && value !== defaultValue) {
                url.searchParams.set(key, value)
            } else {
                url.searchParams.delete(key)
            }
        }

        setPortfolioParam(
            "lifecycle",
            portfolioFilter,
            defaultPortfolioLifecycle
        )
        setPortfolioParam("status", portfolioStatusFilter)
        setPortfolioParam("category", portfolioCategoryFilter)
        setPortfolioParam("attention", portfolioAttentionFilter)
        setPortfolioParam("outcome", portfolioOutcomeFilter)
        setPortfolioParam("learning", portfolioLearningFilter)
        setPortfolioParam("notes", portfolioNotesFilter)
        setPortfolioParam("review", portfolioReviewFilter)
        setPortfolioParam(
            "sort",
            portfolioSort,
            defaultDecisionSort
        )
        setPortfolioParam("search", trimmedPortfolioSearch)

        window.history.replaceState(
            null,
            "",
            url.toString()
        )
    }, [
        portfolioFilter,
        portfolioStatusFilter,
        portfolioCategoryFilter,
        portfolioAttentionFilter,
        portfolioOutcomeFilter,
        portfolioLearningFilter,
        portfolioNotesFilter,
        portfolioReviewFilter,
        portfolioSort,
        trimmedPortfolioSearch,
    ])

    const portfolioSearchPending =
        trimmedPortfolioSearch !== debouncedPortfolioSearch

    const portfolioFiltersActive =
        portfolioFilter !== defaultPortfolioLifecycle ||
        Boolean(portfolioCategoryFilter) ||
        Boolean(portfolioAttentionFilter) ||
        Boolean(portfolioOutcomeFilter) ||
        Boolean(portfolioLearningFilter) ||
        Boolean(portfolioNotesFilter) ||
        Boolean(portfolioReviewFilter) ||
        Boolean(portfolioStatusFilter) ||
        Boolean(trimmedPortfolioSearch) ||
        portfolioSort !== defaultDecisionSort
    const advancedPortfolioFiltersActive =
        Boolean(portfolioAttentionFilter) ||
        Boolean(portfolioOutcomeFilter) ||
        Boolean(portfolioLearningFilter) ||
        Boolean(portfolioNotesFilter) ||
        Boolean(portfolioReviewFilter)

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
        trimmedPortfolioSearch
            ? {
                key: "search",
                label: `Search: ${trimmedPortfolioSearch}`,
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

        const requestId =
            refreshRequestId.current + 1
        refreshRequestId.current = requestId
        activeRefreshRequestId.current = requestId
        portfolioRequestId.current += 1
        activityRequestId.current += 1
        const portfolioRefreshRequestId =
            portfolioRequestId.current
        const activityRefreshRequestId =
            activityRequestId.current
        setWorkspaceRefreshing(true)
        setPortfolioLoading(true)
        setDecisionActivityLoading(true)

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
                        search: trimmedPortfolioSearch,
                        sort: portfolioSort,
                        limit: portfolioPageSize,
                        offset: 0,
                    }
                ),
            ])

            if (refreshRequestId.current !== requestId) {
                if (activeRefreshRequestId.current === requestId) {
                    activeRefreshRequestId.current = null
                    setWorkspaceRefreshing(false)
                    if (
                        activityRequestId.current ===
                        activityRefreshRequestId
                    ) {
                        setDecisionActivityLoading(false)
                    }
                }
                return
            }

            if (summaryResult.status === "fulfilled") {
                setDecisionSummary(summaryResult.value)
            }

            if (
                activityRequestId.current ===
                activityRefreshRequestId
            ) {
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
            }

            if (
                portfolioRequestId.current !==
                portfolioRefreshRequestId
            ) {
                return
            }

            if (portfolioResult.status === "fulfilled") {
                setDecisions(portfolioResult.value)
                setHasMorePortfolioDecisions(
                    portfolioResult.value.length === portfolioPageSize
                )
                setPortfolioLoadError("")
                setPortfolioPaginationError("")
                portfolioLoadedOnce.current = true
            } else {
                setDecisions([])
                setHasMorePortfolioDecisions(false)
                setPortfolioPaginationError("")
                setPortfolioLoadError(
                    getDecisionPageErrorMessage(
                        portfolioResult.reason,
                        "Decision portfolio could not be refreshed."
                    )
                )
            }
        } catch (error) {
            console.error(error)
        } finally {
            if (refreshRequestId.current === requestId) {
                activeRefreshRequestId.current = null
                setWorkspaceRefreshing(false)
                if (
                    portfolioRequestId.current ===
                    portfolioRefreshRequestId
                ) {
                    setPortfolioLoading(false)
                }
                if (
                    activityRequestId.current ===
                    activityRefreshRequestId
                ) {
                    setDecisionActivityLoading(false)
                }
            }
        }
    }

    useEffect(() => {
        if (!user?.id) return
        const userId = user.id
        let cancelled = false
        refreshRequestId.current += 1
        activityRequestId.current += 1
        const workspaceContextRequestId =
            refreshRequestId.current
        const activityLoadRequestId =
            activityRequestId.current
        const workspaceChanged =
            decisionContextWorkspaceId.current !==
            activeWorkspaceId
        decisionContextWorkspaceId.current =
            activeWorkspaceId
        portfolioLoadedOnce.current = false

        if (workspaceChanged) {
            setDecisionSummary(null)
            setDecisionActivityFeed([])
            setHasMoreDecisionActivity(false)
            setDecisionActivityError("")
        }

        async function loadWorkspaceDecisionContext() {
            try {
                const summaryData =
                    await getDecisionSummary(
                        userId,
                        activeWorkspaceId
                    )

                if (
                    cancelled ||
                    refreshRequestId.current !==
                    workspaceContextRequestId
                ) {
                    return
                }

                setDecisionSummary(summaryData)
            } catch (error) {
                if (
                    cancelled ||
                    refreshRequestId.current !==
                    workspaceContextRequestId
                ) {
                    return
                }

                console.error(error)
                setDecisionSummary(null)
            }

            try {
                setDecisionActivityLoading(true)

                const activityData =
                    await getDecisionActivityFeed(
                        userId,
                        activeWorkspaceId,
                        activityFeedPageSize,
                        0
                    )

                if (
                    cancelled ||
                    activityRequestId.current !==
                    activityLoadRequestId
                ) {
                    return
                }

                setDecisionActivityFeed(activityData)
                setHasMoreDecisionActivity(
                    activityData.length === activityFeedPageSize
                )
                setDecisionActivityError("")
            } catch (error) {
                if (
                    cancelled ||
                    activityRequestId.current !==
                    activityLoadRequestId
                ) {
                    return
                }

                console.error(error)
                setDecisionActivityFeed([])
                setHasMoreDecisionActivity(false)
                setDecisionActivityError(
                    getDecisionPageErrorMessage(
                        error,
                        "Decision activity could not be loaded."
                    )
                )
            } finally {
                if (
                    !cancelled &&
                    activityRequestId.current ===
                    activityLoadRequestId
                ) {
                    setDecisionActivityLoading(false)
                }
            }
        }

        void loadWorkspaceDecisionContext()

        return () => {
            cancelled = true
        }
    }, [
        activeWorkspaceId,
        activityRetryKey,
        user?.id,
        workspaceVersion,
    ])

    /* =========================
       Decision Portfolio Search Debounce Before Server Query
    ========================= */

    useEffect(() => {
        const timeout =
            window.setTimeout(() => {
                setDebouncedPortfolioSearch(trimmedPortfolioSearch)
            }, 300)

        return () => {
            window.clearTimeout(timeout)
        }
    }, [trimmedPortfolioSearch])

    useEffect(() => {
        if (!user?.id) return
        const userId = user.id
        let cancelled = false
        portfolioRequestId.current += 1
        const requestId =
            portfolioRequestId.current
        const workspaceChanged =
            portfolioWorkspaceId.current !==
            activeWorkspaceId
        portfolioWorkspaceId.current = activeWorkspaceId

        if (workspaceChanged) {
            setDecisions([])
            setHasMorePortfolioDecisions(false)
        }

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

                if (
                    cancelled ||
                    portfolioRequestId.current !== requestId
                ) {
                    return
                }

                setDecisions(decisionData)
                setHasMorePortfolioDecisions(
                    decisionData.length === portfolioPageSize
                )
            } catch (error) {
                console.error(error)

                if (
                    !cancelled &&
                    portfolioRequestId.current === requestId
                ) {
                    setDecisions([])
                    setHasMorePortfolioDecisions(false)
                    setPortfolioLoadError(
                        error instanceof Error
                            ? error.message
                            : "Decision portfolio could not be loaded."
                    )
                }
            } finally {
                if (
                    !cancelled &&
                    portfolioRequestId.current === requestId
                ) {
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
        if (
            !user?.id ||
            portfolioLoading ||
            portfolioSearchPending
        ) {
            return
        }

        setPortfolioLoading(true)
        const requestId =
            portfolioRequestId.current

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

            if (portfolioRequestId.current !== requestId) {
                return
            }

            setDecisions(currentDecisions =>
                appendUniqueDecisions(
                    currentDecisions,
                    decisionData
                )
            )

            setHasMorePortfolioDecisions(
                decisionData.length === portfolioPageSize
            )
            setPortfolioPaginationError("")
        } catch (error) {
            console.error(error)

            if (portfolioRequestId.current === requestId) {
                setPortfolioPaginationError(
                    getDecisionPageErrorMessage(
                        error,
                        "More decisions could not be loaded."
                    )
                )
            }
        } finally {
            if (portfolioRequestId.current === requestId) {
                setPortfolioLoading(false)
            }
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
        const requestId =
            activityRequestId.current

        try {
            const activityData =
                await getDecisionActivityFeed(
                    user.id,
                    activeWorkspaceId,
                    activityFeedPageSize,
                    decisionActivityFeed.length
                )

            if (activityRequestId.current !== requestId) {
                return
            }

            setDecisionActivityFeed(currentFeed =>
                appendUniqueDecisionActivity(
                    currentFeed,
                    activityData
                )
            )

            setHasMoreDecisionActivity(
                activityData.length === activityFeedPageSize
            )
            setDecisionActivityError("")
        } catch (error) {
            console.error(error)

            if (activityRequestId.current === requestId) {
                setDecisionActivityError(
                    getDecisionPageErrorMessage(
                        error,
                        "More decision activity could not be loaded."
                    )
                )
            }
        } finally {
            if (activityRequestId.current === requestId) {
                setDecisionActivityLoading(false)
            }
        }
    }

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

    const outcomePendingCount =
        decisionSummary?.outcomes_pending ??
        decisions.filter(
            hasPendingOutcome
        ).length

    const learningPendingCount =
        decisionSummary?.learning_pending ??
        decisions.filter(
            hasPendingLearning
        ).length

    const attentionRequiredCount =
        decisionSummary?.attention_required ??
        decisions.filter(
            decision =>
                hasPendingOutcome(decision) ||
                hasPendingLearning(decision) ||
                (
                    Boolean(decision.review_date) &&
                    Boolean(
                        getDecisionDateValue(decision.review_date)
                    ) &&
                    getDecisionDateValue(decision.review_date)! < today
                )
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
    const activityFeedEmpty =
        decisionActivityFeed.length === 0
    const activityFeedLoadingEmpty =
        decisionActivityLoading &&
        activityFeedEmpty
    const activityFeedErrorEmpty =
        Boolean(decisionActivityError) &&
        activityFeedEmpty
    const actionNeededView =
        portfolioAttentionFilter === "required"
    const portfolioEmptyTitle =
        actionNeededView
            ? trimmedPortfolioSearch
                ? "No action-needed decisions match"
                : "No action needed"
            : "No decisions in this view"
    const portfolioEmptyDescription =
        actionNeededView
            ? trimmedPortfolioSearch
                ? "Clear the search or adjust filters to review the rest of the action queue."
                : "Pending outcomes, learning follow-ups and overdue reviews are clear."
            : "Adjust the filter or search to review the rest of your decision portfolio."
    const portfolioEmptyResetLabel =
        actionNeededView && !trimmedPortfolioSearch
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

    async function copyPortfolioViewLink() {
        if (typeof window === "undefined") {
            return
        }

        try {
            await navigator.clipboard.writeText(
                window.location.href
            )
            setPortfolioLinkStatus({
                message: "View link copied",
                viewKey: portfolioViewKey,
            })
        } catch {
            setPortfolioLinkStatus({
                message: "Could not copy view link",
                viewKey: portfolioViewKey,
            })
        }
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
            <DashboardPageHeader
                title="Decisions"
                description="Track decisions, review outcomes, and learn what works."
                actions={canManageWorkspaceData ? (
                    <Link
                        href="/dashboard/decisions/new?returnTo=%2Fdashboard%2Fdecisions"
                        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--decisionate-brand-primary)] px-4 text-sm font-medium text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90 sm:w-auto"
                    >
                        <Plus size={16} />
                        New Decision
                    </Link>
                ) : undefined}
            />

            <WorkspaceAccessNotice
                loading={loadingWorkspaceAccess}
                canManageWorkspaceData={canManageWorkspaceData}
                message="This client workspace is read-only. You can review decisions and their activity here."
                className="rounded-xl"
            />

            <div className="grid gap-6">
                <DashboardCard className="h-full p-4 sm:p-5">
                    <CardHeader
                        title="Action Queue"
                        description="Outcome, learning, and overdue-review work that needs attention."
                        icon={
                            <IconBadge
                                className="bg-amber-50 text-amber-600"
                                icon={<Gauge size={22} />}
                            />
                        }
                    />

                    <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <MetricCard
                            label="Action Needed"
                            value={attentionRequiredCount}
                            onClick={showAttentionRequiredDecisions}
                        />

                        <MetricCard
                            label="Outcome Pending"
                            value={outcomePendingCount}
                            onClick={() =>
                                showOutcomeWorkflowDecisions("pending")
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
                    </div>
                </DashboardCard>
            </div>

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
                            className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 text-gray-500 transition hover:border-[var(--decisionate-brand-primary-ring)] hover:text-[var(--decisionate-brand-primary-text)] disabled:cursor-not-allowed disabled:text-gray-300"
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
                    <div
                        className="mt-4 flex flex-col gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between"
                        role="alert"
                    >
                        <span>{decisionActivityError}</span>

                        <button
                            type="button"
                            onClick={() =>
                                setActivityRetryKey(
                                    currentKey => currentKey + 1
                                )
                            }
                            className="w-fit rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-700 transition hover:bg-red-50"
                        >
                            Retry
                        </button>
                    </div>
                )}

                {activityFeedLoadingEmpty ? (
                    <div
                        className="mt-4 flex h-36 flex-col items-center justify-center rounded-xl border border-gray-100 bg-gray-50 text-center"
                        role="status"
                        aria-live="polite"
                    >
                        <p className="text-sm font-medium text-gray-600">
                            Loading activity...
                        </p>
                    </div>
                ) : activityFeedErrorEmpty ? null
                : activityFeedEmpty ? (
                    <EmptyState
                        title="No activity yet"
                        description="Decision updates will appear here as work happens."
                    />
                ) : (
                    <div className="mt-4 divide-y divide-gray-100 md:max-h-72 md:overflow-y-auto md:pr-2">
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
                                    className="inline-flex h-9 items-center justify-center rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-600 transition hover:border-[var(--decisionate-brand-primary-ring)] hover:text-[var(--decisionate-brand-primary-text)] disabled:cursor-not-allowed disabled:text-gray-300"
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

            <DashboardCard id="decision-portfolio" className="scroll-mt-4">
                <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                        <h2 className="break-words text-2xl font-semibold">
                            Decision Portfolio
                        </h2>

                        <p className="mt-1 break-words text-sm text-gray-500">
                            Search, filter, and resolve follow-up work across decisions.
                        </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                        {canManageWorkspaceData && (
                            <Link
                                href="/dashboard/decisions/new?returnTo=%2Fdashboard%2Fdecisions"
                                className="hidden h-10 items-center justify-center gap-2 rounded-lg border border-[var(--decisionate-brand-primary-ring)] px-3 text-sm font-medium text-[var(--decisionate-brand-primary-text)] transition hover:bg-[var(--decisionate-brand-primary-soft)] sm:inline-flex"
                            >
                                <Plus size={16} />
                                New Decision
                            </Link>
                        )}

                        <IconBadge
                            className="bg-[var(--decisionate-brand-accent-soft)] text-[var(--decisionate-brand-accent-text)]"
                            icon={<BriefcaseBusiness size={22} />}
                        />
                    </div>
                </div>

                {/* =========================
                    Decision Portfolio Controls For Lifecycle Filter And Search
                ========================= */}

                <div className="mt-5 space-y-3 rounded-2xl bg-gray-50/70 p-3 sm:p-4">
                    <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                        <div className="flex min-w-0 flex-wrap gap-2">
                            {portfolioFilters.map(filter => {
                                const active =
                                    portfolioFilter === filter.key

                                return (
                                    <button
                                        key={filter.key}
                                        type="button"
                                        aria-pressed={active}
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
                                            active
                                        )}
                                    >
                                        {filter.label}
                                        <span className="ml-2 rounded-full bg-white/70 px-2 py-0.5 text-xs">
                                            {filter.count}
                                        </span>
                                    </button>
                                )
                            })}
                        </div>

                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3 xl:justify-end">
                            {/* =========================
                                Decision Portfolio Status Filter For Server Query
                            ========================= */}

                            <select
                                aria-label="Filter decisions by status"
                                value={portfolioStatusFilter}
                                disabled={
                                    portfolioFilter === archivedPortfolioLifecycle
                                }
                                onChange={(event) =>
                                    setPortfolioStatusFilter(
                                        event.target.value as PortfolioStatusFilter
                                    )
                                }
                                className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)] disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 sm:w-auto"
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
                                aria-label="Filter decisions by category"
                                value={portfolioCategoryFilter}
                                onChange={(event) =>
                                    setPortfolioCategoryFilter(
                                        event.target.value as PortfolioCategoryFilter
                                    )
                                }
                                className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)] sm:w-auto"
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
                        </div>
                    </div>

                    <details
                        className="rounded-xl border border-gray-100 bg-white/95 p-3 shadow-sm"
                        open={
                            advancedPortfolioFiltersActive
                                ? true
                                : undefined
                        }
                    >
                        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 text-sm font-medium text-gray-700">
                            <span>
                                More filters
                            </span>

                            <span className="text-xs font-normal text-gray-500">
                                Outcome, learning, notes, review
                                {advancedPortfolioFiltersActive
                                    ? " • active"
                                    : ""}
                            </span>
                        </summary>

                        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                            {/* =========================
                                Decision Portfolio Attention Filter For Aggregate Follow-Up Work
                            ========================= */}

                            <select
                                aria-label="Filter decisions by action state"
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
                                className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
                            >
                                <option value="">All action states</option>
                                <option value="required">Action needed</option>
                            </select>

                            {/* =========================
                                Decision Portfolio Outcome Workflow Filter For Server Query
                            ========================= */}

                            <select
                                aria-label="Filter decisions by outcome work"
                                value={portfolioOutcomeFilter}
                                onChange={(event) => {
                                    setPortfolioAttentionFilter("")
                                    setPortfolioOutcomeFilter(
                                        event.target.value as PortfolioOutcomeFilter
                                    )
                                }}
                                className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
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
                                aria-label="Filter decisions by learning work"
                                value={portfolioLearningFilter}
                                onChange={(event) => {
                                    setPortfolioAttentionFilter("")
                                    setPortfolioLearningFilter(
                                        event.target.value as PortfolioLearningFilter
                                    )
                                }}
                                className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
                            >
                                <option value="">All learning work</option>
                                <option value="captured">Learning captured</option>
                                <option value="pending">Learning pending</option>
                            </select>

                            {/* =========================
                                Decision Portfolio Notes Workflow Filter For Server Query
                            ========================= */}

                            <select
                                aria-label="Filter decisions by note work"
                                value={portfolioNotesFilter}
                                onChange={(event) => {
                                    setPortfolioAttentionFilter("")
                                    setPortfolioNotesFilter(
                                        event.target.value as PortfolioNotesFilter
                                    )
                                }}
                                className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
                            >
                                <option value="">All note work</option>
                                <option value="added">Notes added</option>
                                <option value="pending">Notes pending</option>
                            </select>

                            {/* =========================
                                Decision Portfolio Review Workflow Filter For Server Query
                            ========================= */}

                            <select
                                aria-label="Filter decisions by review work"
                                value={portfolioReviewFilter}
                                onChange={(event) => {
                                    setPortfolioAttentionFilter("")
                                    setPortfolioReviewFilter(
                                        event.target.value as PortfolioReviewFilter
                                    )
                                }}
                                className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
                            >
                                <option value="">All review work</option>
                                <option value="scheduled">Review scheduled</option>
                                <option value="overdue">Review overdue</option>
                                <option value="upcoming">Review upcoming</option>
                            </select>
                        </div>
                    </details>

                    <div className="flex min-w-0 flex-wrap items-center gap-3">
                        {/* =========================
                            Decision Portfolio Sort Control For Server Ordering
                        ========================= */}

                        <select
                            aria-label="Sort decisions"
                            value={portfolioSort}
                            onChange={(event) =>
                                setPortfolioSort(
                                    event.target.value as PortfolioSort
                                )
                            }
                            className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)] sm:w-auto"
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

                        <div className="relative min-w-0 w-full sm:w-72">
                            <Search
                                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                                size={16}
                            />

                            <input
                                aria-label="Search decisions"
                                value={portfolioSearch}
                                onChange={(event) =>
                                    setPortfolioSearch(event.target.value)
                                }
                                placeholder="Search decisions"
                                className="h-10 w-full rounded-lg border border-gray-200 pl-9 pr-9 text-sm focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
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
                            <p
                                className="text-sm text-gray-500"
                                role="status"
                                aria-live="polite"
                            >
                                {portfolioSearchPending
                                    ? "Preparing search..."
                                    : "Loading decisions..."}
                            </p>
                        )}

                        {portfolioFiltersActive && (
                            <>
                                <button
                                    type="button"
                                    aria-label="Copy current decision portfolio view link"
                                    onClick={copyPortfolioViewLink}
                                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-600 transition hover:border-[var(--decisionate-brand-primary-ring)] hover:text-[var(--decisionate-brand-primary-text)] sm:w-auto"
                                >
                                    <Link2 size={15} />
                                    Copy view link
                                </button>

                                <button
                                    type="button"
                                    aria-label="Reset all decision portfolio filters"
                                    onClick={resetPortfolioFilters}
                                    className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-600 transition hover:border-[var(--decisionate-brand-primary-ring)] hover:text-[var(--decisionate-brand-primary-text)] sm:w-auto"
                                >
                                    Reset filters
                                </button>
                            </>
                        )}

                        {portfolioLinkStatus?.viewKey === portfolioViewKey && (
                            <div
                                className="basis-full rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-700"
                                role="status"
                                aria-live="polite"
                            >
                                {portfolioLinkStatus.message}
                            </div>
                        )}
                    </div>
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
                                aria-label={`Clear decision portfolio filter: ${chip.label}`}
                                onClick={chip.onClear}
                                className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-600 transition hover:border-[var(--decisionate-brand-primary-ring)] hover:text-[var(--decisionate-brand-primary-text)]"
                            >
                                {chip.label}
                                <X size={12} />
                            </button>
                        ))}
                    </div>
                )}
            </DashboardCard>

            {portfolioInitialLoading ? (
                <DashboardCard
                    className="border-dashed text-center"
                    role="status"
                    aria-live="polite"
                >
                    <p className="text-sm font-medium text-gray-600">
                        Loading decision portfolio...
                    </p>
                </DashboardCard>
            ) : portfolioLoadError ? (
                <DashboardCard
                    className="border-dashed text-center"
                    role="alert"
                >
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
                        className="mt-4 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition hover:border-[var(--decisionate-brand-primary-ring)] hover:text-[var(--decisionate-brand-primary-text)]"
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
                        {canManageWorkspaceData
                            ? "Create your first decision to start tracking outcomes and learning what works."
                            : "No decisions have been shared with this client workspace yet."}
                    </p>

                    {canManageWorkspaceData && (
                        <Link
                            href="/dashboard/decisions/new?returnTo=%2Fdashboard%2Fdecisions"
                            className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[var(--decisionate-brand-primary)] px-4 text-sm font-medium text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90 sm:w-auto"
                        >
                            <Plus size={16} />
                            Create Decision
                        </Link>
                    )}
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
                            aria-label="Reset all decision portfolio filters"
                            onClick={resetPortfolioFilters}
                            className="mt-4 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition hover:border-[var(--decisionate-brand-primary-ring)] hover:text-[var(--decisionate-brand-primary-text)]"
                        >
                            {portfolioEmptyResetLabel}
                        </button>
                    )}
                </DashboardCard>
            ) : (
                /* =========================
                    Decision Portfolio Scrollable Card Grid For Large Workspaces
                ========================= */

                <div className="xl:max-h-[42rem] xl:overflow-y-auto xl:pr-2">
                    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                        {decisions.map(decision => (
                            <DecisionCard
                                key={decision.id}
                                decision={decision}
                            />
                        ))}
                    </div>

                    {portfolioPaginationError && (
                        <div
                            className="mt-5 flex flex-col gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between"
                            role="alert"
                        >
                            <span>{portfolioPaginationError}</span>

                            <button
                                type="button"
                                onClick={handleLoadMoreDecisions}
                                disabled={portfolioLoading}
                                className="w-fit rounded-md border border-red-200 bg-white px-3 py-1 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:text-red-300"
                            >
                                Retry
                            </button>
                        </div>
                    )}

                    {hasMorePortfolioDecisions && (
                        <div className="mt-5 bg-white/95 py-3 text-center backdrop-blur xl:sticky xl:bottom-0">
                            <button
                                type="button"
                                onClick={handleLoadMoreDecisions}
                                disabled={
                                    portfolioLoading ||
                                    portfolioSearchPending
                                }
                                className={getLoadMoreButtonClass(
                                    portfolioLoading ||
                                    portfolioSearchPending
                                )}
                            >
                                {portfolioSearchPending
                                    ? "Preparing search..."
                                    : portfolioLoading
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
    ...props
}: React.HTMLAttributes<HTMLDivElement> & {
    children: React.ReactNode
    className?: string
}) {
    return (
        <div
            className={`min-w-0 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm ${className}`}
            {...props}
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
        <div className="flex min-w-0 items-start justify-between gap-4">
            <div className="min-w-0">
                <h2 className="break-words text-xl font-semibold tracking-tight">
                    {title}
                </h2>

                <p className="mt-1 break-words text-sm text-gray-600">
                    {description}
                </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
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
            ? " transition hover:border-[var(--decisionate-brand-primary-ring)] hover:bg-[var(--decisionate-brand-primary-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)]"
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
        <div className="mt-4 flex h-36 flex-col items-center justify-center rounded-xl border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] text-center">
            <p className="text-sm font-medium text-[var(--decisionate-brand-primary-text)]">
                {title}
            </p>

            <p className="mt-1 text-xs text-[var(--decisionate-brand-primary-text)] opacity-75">
                {description}
            </p>
        </div>
    )
}

/* =========================
   Decision Portfolio Filter And Search Helpers
========================= */

function getPortfolioFilterClass(active: boolean) {
    return `inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-medium transition ${
        active
            ? "border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] text-[var(--decisionate-brand-primary-text)]"
            : "border-gray-200 bg-white text-gray-600 hover:border-[var(--decisionate-brand-primary-ring)] hover:text-[var(--decisionate-brand-primary-text)]"
    }`
}

function getLoadMoreButtonClass(disabled: boolean) {
    return `rounded-xl border px-4 py-2 text-sm font-medium transition ${
        disabled
            ? "cursor-not-allowed border-gray-200 text-gray-400"
            : "border-[var(--decisionate-brand-primary-ring)] text-[var(--decisionate-brand-primary-text)] hover:bg-[var(--decisionate-brand-primary-soft)]"
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

function appendUniqueDecisions(
    currentDecisions: DecisionListRecord[],
    incomingDecisions: DecisionListRecord[]
) {
    const seenDecisionIds =
        new Set(
            currentDecisions.map(decision => decision.id)
        )

    return [
        ...currentDecisions,
        ...incomingDecisions.filter(decision => {
            if (seenDecisionIds.has(decision.id)) {
                return false
            }

            seenDecisionIds.add(decision.id)
            return true
        }),
    ]
}

function appendUniqueDecisionActivity(
    currentFeed: DecisionActivityFeedItem[],
    incomingFeed: DecisionActivityFeedItem[]
) {
    const seenActivityIds =
        new Set(
            currentFeed.map(activityItem => activityItem.id)
        )

    return [
        ...currentFeed,
        ...incomingFeed.filter(activityItem => {
            if (seenActivityIds.has(activityItem.id)) {
                return false
            }

            seenActivityIds.add(activityItem.id)
            return true
        }),
    ]
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

                <span className="mt-1 block break-words text-sm text-gray-500">
                    {activityItem.message}
                </span>

                {!decisionAvailable && (
                    <span className="mt-1 block text-xs font-medium text-gray-400">
                        Decision not available
                    </span>
                )}
            </span>

            <span className="flex w-full shrink-0 items-start justify-between gap-3 pl-5 sm:w-auto sm:justify-start sm:pl-0">
                <span className="flex flex-col items-start gap-1 sm:items-end">
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
                            ? "text-gray-300 group-hover:text-[var(--decisionate-brand-primary-text)]"
                            : "text-gray-200"
                    }`}
                    size={16}
                />
            </span>
        </>
    )

    if (!decisionAvailable) {
        return (
            <div className="flex flex-wrap items-start gap-3 py-3 opacity-75">
                {rowContent}
            </div>
        )
    }

    return (
        <Link
            href={`/dashboard/decisions/${activityItem.decision_id}`}
            aria-label={`${activityItem.decision_title}: ${activityItem.message}`}
            className="group flex flex-wrap items-start gap-3 py-3 transition hover:bg-gray-50"
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

    if (
        actions.length === 0 &&
        hasPendingNotes(decision)
    ) {
        actions.push(addNotesFollowUpAction)
    }

    return actions
}

function getHealthBadgeClass(health: DecisionHealthLabel) {
    if (health === healthyDecisionHealthLabel) {
        return "border-green-200 bg-green-50 text-green-700"
    }

    if (health === needsReviewDecisionHealthLabel) {
        return "border-amber-200 bg-amber-50 text-amber-700"
    }

    if (health === inProgressDecisionHealthLabel) {
        return "border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] text-[var(--decisionate-brand-primary-text)]"
    }

    if (health === cancelledDecisionHealthLabel) {
        return "border-red-200 bg-red-50 text-red-700"
    }

    if (health === archivedDecisionHealthLabel) {
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
    const documentationOnlyAction =
        followUpActions.length === 1 &&
        followUpActions[0] === addNotesFollowUpAction
    const decisionHref =
        followUpActions.length > 0
            ? `/dashboard/decisions/${decision.id}?focus=next-action`
            : `/dashboard/decisions/${decision.id}`
    const analysisSource =
        getAIRecommendationSource(
            decision.description
        )

    return (
        <Link
            href={decisionHref}
            className={getDecisionCardClass(isArchived)}
        >
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <h2 className="min-w-0 break-words text-lg font-semibold">
                    {decision.title}
                </h2>

                <span
                    className={`w-fit shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${getHealthBadgeClass(
                        health
                    )}`}
                >
                    {health}
                </span>
            </div>

            <p className="mt-3 break-words text-sm text-gray-500 line-clamp-2">
                {decision.description ||
                    "No description provided."}
            </p>

            {expectedOutcome && (
                <p className="mt-3 break-words border-l-2 border-green-200 pl-3 text-sm text-gray-600 line-clamp-2">
                    <span className="font-medium text-green-700">
                        Expected:
                    </span>{" "}
                    {expectedOutcome}
                </p>
            )}

            {followUpActions.length > 0 && (
                <div
                    className={`mt-3 rounded-xl border px-3 py-2 ${
                        documentationOnlyAction
                            ? "border-gray-200 bg-gray-50"
                            : "border-amber-100 bg-amber-50"
                    }`}
                >
                    <p
                        className={`text-xs font-semibold uppercase tracking-wide ${
                            documentationOnlyAction
                                ? "text-gray-600"
                                : "text-amber-700"
                        }`}
                    >
                        {documentationOnlyAction
                            ? "Completeness gap"
                            : "Action needed"}
                    </p>

                    <div className="mt-2 flex flex-wrap gap-2">
                        {followUpActions.map(action => (
                            <span
                                key={action}
                                className={`max-w-full break-words rounded-full bg-white px-2.5 py-1 text-xs font-medium shadow-sm ${
                                    documentationOnlyAction
                                        ? "text-gray-700"
                                        : "text-amber-700"
                                }`}
                            >
                                {action}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            <div className="mt-4 grid grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
                {decision.category && (
                    <span className="flex min-w-0 items-center gap-1 break-words text-[var(--decisionate-brand-primary-text)]">
                        <FolderOpen size={12} className="shrink-0" />
                        {formatDecisionLabel(decision.category)}
                    </span>
                )}

                {decision.metric_column && (
                    <span className="flex min-w-0 items-center gap-1 break-words text-[var(--decisionate-brand-primary-text)]">
                        <LineChartIcon size={12} className="shrink-0" />
                        Metric: {formatMetricLabel(decision.metric_column)}
                    </span>
                )}

                {analysisSource && (
                    <span
                        className="flex min-w-0 items-center gap-1 break-words text-blue-700"
                        title={analysisSource}
                    >
                        <BriefcaseBusiness size={12} className="shrink-0" />
                        Analysis: {analysisSource}
                    </span>
                )}

                {decision.review_date && (
                    <span className="flex min-w-0 items-center gap-1 break-words text-amber-600">
                        <Calendar size={12} className="shrink-0" />
                        Review:{" "}
                        {formatDecisionDate(decision.review_date)}
                    </span>
                )}

                {decision.priority && (
                    <span className="flex min-w-0 items-center gap-1 break-words text-red-600">
                        <Flag size={12} className="shrink-0" />
                        Priority: {formatDecisionLabel(decision.priority)}
                    </span>
                )}

                {outcomePending && (
                    <span className="flex min-w-0 items-center gap-1 break-words text-amber-600">
                        <Target size={12} className="shrink-0" />
                        Outcome Pending
                    </span>
                )}

                {hasRecordedOutcome(decision) && (
                    <span className="flex min-w-0 items-center gap-1 break-words text-green-600">
                        <Target size={12} className="shrink-0" />
                        {decision.outcome_status
                            ? formatDecisionLabel(decision.outcome_status)
                            : "Actual Recorded"}
                    </span>
                )}

                {learningPending && (
                    <span className="flex min-w-0 items-center gap-1 break-words text-[var(--decisionate-brand-accent-text)]">
                        <Lightbulb size={12} className="shrink-0" />
                        Learning Pending
                    </span>
                )}

                {notesPending && (
                    <span className="flex min-w-0 items-center gap-1 break-words text-gray-600">
                        <FileText size={12} className="shrink-0" />
                        Notes Pending
                    </span>
                )}

                {decision.confidence_score && (
                    <span className="flex min-w-0 items-center gap-1 break-words text-[var(--decisionate-brand-primary-text)]">
                        <Gauge size={12} className="shrink-0" />
                        Confidence: {formatDecisionLabel(decision.confidence_score)}
                    </span>
                )}

                {lastUpdatedLabel && (
                    <span className="flex min-w-0 items-center gap-1 break-words text-gray-500">
                        <Activity size={12} className="shrink-0" />
                        {lastUpdatedLabel}
                    </span>
                )}
            </div>

            <div className="mt-4 border-t border-gray-100 pt-3">
                <div className="flex min-w-0 flex-col gap-2 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <span className="min-w-0 break-words text-gray-400">
                        {isArchived
                            ? "Historical record"
                            : followUpActions.length > 0
                              ? documentationOnlyAction
                                ? "Record can be completed"
                                : "Next action ready"
                            : "Click to manage decision"}
                    </span>

                    <span className="w-fit shrink-0 font-medium text-[var(--decisionate-brand-primary-text)]">
                        {isArchived
                            ? "View Archived Record →"
                            : followUpActions.length > 0
                              ? documentationOnlyAction
                                ? "Complete Record →"
                                : "Resolve Next Action →"
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
    return `block min-w-0 rounded-2xl border p-5 shadow-sm transition hover:shadow-md sm:p-6 ${
        archived
            ? "border-gray-200 bg-gray-50 hover:border-gray-300"
            : "border-gray-200 bg-white hover:border-[var(--decisionate-brand-primary-ring)]"
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
