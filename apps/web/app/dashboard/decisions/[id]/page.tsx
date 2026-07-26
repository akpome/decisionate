"use client"

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"

import Link from "next/link"
import {
  useParams,
  useSearchParams,
} from "next/navigation"
import { useUser } from "@clerk/nextjs"

import {
  ArrowLeft,
  Archive,
  Calendar,
  ClipboardList,
  FileText,
  HeartPulse,
  Lightbulb,
  Target,
} from "lucide-react"

import {
  ApiError,
  archiveDecision,
  getDataset,
  getDatasetMetrics,
  getDecisionActivities,
  getDecision,
  getDecisionOutcomeAnalysis,
  restoreDecision,
  updateDecisionDetails,
  updateDecisionOverview,
  updateDecisionNotes,
  updateDecisionOutcome,
  updateDecisionLearning,
} from "@/lib/api"
import {
  getDecisionActivityDotClass,
  getDecisionActivityTitleClass,
} from "@/lib/decision-activity-style"
import {
  hasAddedNotes,
  hasCapturedLearning,
  hasPendingLearning,
  hasPendingOutcome,
  hasPlannedOutcome,
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
import {
  archiveDecisionActivity,
  archivedDecisionStatus,
  decisionCategoryOptions,
  decisionConfidenceOptions,
  detailsDecisionActivity,
  defaultDecisionCategory,
  defaultDecisionPriority,
  defaultDecisionStatus,
  decisionOutcomeStatusOptions,
  decisionPriorityOptions,
  decisionStatusOptions,
  formatDecisionLabel,
  learningDecisionActivity,
  notesDecisionActivity,
  outcomeDecisionActivity,
  overviewDecisionActivity,
  restoreDecisionActivity,
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
import {
  getDatasetSourceDetails,
} from "@/features/datasets/lib/source-config"
import { getAIRecommendationSource } from "@/features/decisions/lib/ai-recommendation-source"
import {
  AIAnalysisPanel,
} from "@/features/ai/components/analysis-panel"
import {
  AnalysisStatus,
} from "@/features/ai/components/analysis-status"
import {
  MetricSelector,
  formatMetricLabel,
} from "@/features/dashboard/components/metric-selector"
import type {
  AIAnalysis,
  DatasetSummary,
  DecisionActivity,
  DecisionCategory,
  DecisionConfidenceScore,
  DecisionDetailsPayload,
  DecisionOutcomePayload,
  DecisionOutcomeStatus,
  DecisionOverviewPayload,
  DecisionPriority,
  DecisionRecord,
  DecisionStatus,
} from "@/lib/api"

const inputClass =
  "mt-2 h-10 w-full rounded-lg border border-gray-200 px-3 focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)] disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"

const textareaClass =
  "mt-2 w-full rounded-lg border border-gray-200 p-3 focus:border-[var(--decisionate-brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--decisionate-brand-primary-ring)] disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"

const timelineActivityPageSize = 20
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
const learningCapturePrompts = [
  {
    label: "What worked?",
    text: "What worked:\n- ",
  },
  {
    label: "What surprised us?",
    text: "What surprised us:\n- ",
  },
  {
    label: "What to repeat?",
    text: "What to repeat next time:\n- ",
  },
  {
    label: "What to avoid?",
    text: "What to avoid next time:\n- ",
  },
]
const decisionNotePrompts = [
  {
    label: "Assumption",
    text: "Assumption:\n- ",
  },
  {
    label: "Risk",
    text: "Risk:\n- ",
  },
  {
    label: "Evidence",
    text: "Evidence:\n- ",
  },
  {
    label: "Follow-up",
    text: "Follow-up:\n- ",
  },
]

type SaveSection =
  | typeof archiveDecisionActivity
  | typeof restoreDecisionActivity
  | typeof detailsDecisionActivity
  | typeof overviewDecisionActivity
  | typeof notesDecisionActivity
  | typeof outcomeDecisionActivity
  | typeof learningDecisionActivity

type SaveError = {
  section: SaveSection
  message: string
}

type DecisionConfidenceFormValue =
  | DecisionConfidenceScore
  | ""

type DecisionOutcomeStatusFormValue =
  | DecisionOutcomeStatus
  | ""

type DecisionNextActionTarget = {
  elementId: string
  label: string
}

export default function DecisionPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const { user } = useUser()
  const {
    activeWorkspaceId,
    workspaceVersion,
  } = useActiveWorkspace(user?.id)
  const {
    canManageWorkspaceData,
    loadingWorkspaceAccess,
  } = useWorkspaceAccess(user?.id)

  const [decision, setDecision] =
    useState<DecisionRecord | null>(null)

  const [dataset, setDataset] =
    useState<DatasetSummary | null>(null)

  const [activities, setActivities] =
    useState<DecisionActivity[]>([])
  const [hasMoreActivities, setHasMoreActivities] =
    useState(false)
  const [activitiesLoading, setActivitiesLoading] =
    useState(false)
  const [activityLoadError, setActivityLoadError] =
    useState("")

  const [title, setTitle] = useState("")
  const [originalTitle, setOriginalTitle] = useState("")

  const [description, setDescription] = useState("")
  const [originalDescription, setOriginalDescription] = useState("")

  const [metricColumn, setMetricColumn] = useState("")
  const [originalMetricColumn, setOriginalMetricColumn] = useState("")
  const [metricColumns, setMetricColumns] = useState<string[]>([])
  const [metricsLoading, setMetricsLoading] = useState(false)
  const [metricLoadError, setMetricLoadError] = useState("")

  const [detailsSaved, setDetailsSaved] = useState(false)

  const [archiveSaved, setArchiveSaved] = useState(false)
  const [restoreSaved, setRestoreSaved] = useState(false)

  const [savingSection, setSavingSection] =
    useState<SaveSection | null>(null)

  const [saveError, setSaveError] =
    useState<SaveError | null>(null)
  const [loadError, setLoadError] =
    useState("")
  const [loadRetryKey, setLoadRetryKey] =
    useState(0)
  const [metricLoadRetryKey, setMetricLoadRetryKey] =
    useState(0)

  const [status, setStatus] =
    useState<DecisionStatus>(defaultDecisionStatus)
  const [originalStatus, setOriginalStatus] =
    useState<DecisionStatus>(defaultDecisionStatus)

  const [priority, setPriority] =
    useState<DecisionPriority>(defaultDecisionPriority)
  const [originalPriority, setOriginalPriority] =
    useState<DecisionPriority>(defaultDecisionPriority)

  const [category, setCategory] =
    useState<DecisionCategory>(defaultDecisionCategory)
  const [originalCategory, setOriginalCategory] =
    useState<DecisionCategory>(defaultDecisionCategory)

  const [confidenceScore, setConfidenceScore] =
    useState<DecisionConfidenceFormValue>("")
  const [originalConfidenceScore, setOriginalConfidenceScore] =
    useState<DecisionConfidenceFormValue>("")

  const [reviewDate, setReviewDate] = useState("")
  const [originalReviewDate, setOriginalReviewDate] = useState("")

  const [overviewSaved, setOverviewSaved] = useState(false)

  const [notes, setNotes] = useState("")
  const [originalNotes, setOriginalNotes] = useState("")
  const [noteSaved, setNoteSaved] = useState(false)

  const [expectedOutcome, setExpectedOutcome] = useState("")
  const [originalExpectedOutcome, setOriginalExpectedOutcome] = useState("")

  const [actualOutcome, setActualOutcome] = useState("")
  const [originalActualOutcome, setOriginalActualOutcome] = useState("")

  const [outcomeStatus, setOutcomeStatus] =
    useState<DecisionOutcomeStatusFormValue>("")
  const [originalOutcomeStatus, setOriginalOutcomeStatus] =
    useState<DecisionOutcomeStatusFormValue>("")

  const [outcomeSaved, setOutcomeSaved] = useState(false)
  const [outcomeAnalysis, setOutcomeAnalysis] =
    useState<AIAnalysis | null>(null)
  const [outcomeAnalysisLoading, setOutcomeAnalysisLoading] =
    useState(false)
  const [outcomeAnalysisError, setOutcomeAnalysisError] =
    useState(false)
  const [outcomeAnalysisRetryKey, setOutcomeAnalysisRetryKey] =
    useState(0)

  const [lessonsLearned, setLessonsLearned] = useState("")
  const [originalLessonsLearned, setOriginalLessonsLearned] = useState("")
  const [learningSaved, setLearningSaved] = useState(false)
  const savedFeedbackTimeouts = useRef<
    Partial<Record<SaveSection, number>>
  >({})
  const activeTimelineDecisionId = useRef<number | null>(
    null
  )
  const lastAutoFocusedDecisionKey = useRef<string | null>(null)
  const shouldFocusNextAction =
    searchParams.get("focus") === "next-action"
  const showActionQueueBackLink =
    searchParams.get("source") === "action-needed"

  function showSectionSaved(
    section: SaveSection,
    setter: (value: boolean) => void
  ) {
    const existingTimeout =
      savedFeedbackTimeouts.current[section]

    if (existingTimeout !== undefined) {
      window.clearTimeout(existingTimeout)
    }

    setter(true)
    savedFeedbackTimeouts.current[section] =
      window.setTimeout(() => {
        setter(false)
        delete savedFeedbackTimeouts.current[section]
      }, 3000)
  }

  useEffect(() => {
    const timeouts = savedFeedbackTimeouts.current
    return () => {
      Object.values(timeouts).forEach(
        timeoutId => window.clearTimeout(timeoutId)
      )
    }
  }, [])

  useEffect(() => {
    if (!user?.id) return
    const userId = user.id
    let ignoreResult = false

    async function load() {
      try {
        setDecision(null)
        setDataset(null)
        setMetricColumns([])
        setMetricsLoading(false)
        setMetricLoadError("")
        setActivities([])
        setHasMoreActivities(false)
        setActivityLoadError("")
        setDetailsSaved(false)
        setOverviewSaved(false)
        setNoteSaved(false)
        setOutcomeSaved(false)
        setLearningSaved(false)
        setSaveError(null)
        activeTimelineDecisionId.current = null
        setLoadError("")

        const decisionId =
          getDecisionRouteId(params.id)

        if (decisionId === null) {
          setDecision(null)
          setLoadError(
            "This decision link is invalid."
          )
          return
        }

        const data = await getDecision(
          decisionId,
          userId,
          activeWorkspaceId
        )

        if (ignoreResult) {
          return
        }

        activeTimelineDecisionId.current =
          data.id
        setDecision(data)

        syncDetailsFormFromDecision(
          data
        )

        syncOverviewFormFromDecision(
          data
        )

        syncNotesFormFromDecision(
          data
        )

        syncOutcomeFormFromDecision(
          data
        )

        syncLearningFormFromDecision(
          data
        )

        void loadActivities(
          data.id,
          userId,
          activeWorkspaceId,
          () => !ignoreResult
        )

        setMetricsLoading(true)

        const [
          datasetResult,
          metricsResult,
        ] = await Promise.allSettled([
          getDataset(
            data.dataset_id,
            userId,
            activeWorkspaceId
          ),
          getDatasetMetrics(
            data.dataset_id,
            userId,
            activeWorkspaceId
          ),
        ])

        if (ignoreResult) {
          return
        }

        if (datasetResult.status === "fulfilled") {
          setDataset(datasetResult.value)
        } else {
          console.error(datasetResult.reason)
          setDataset(null)
        }

        if (metricsResult.status === "fulfilled") {
          setMetricColumns(
            metricsResult.value.metrics
              .map(metric => metric.column.trim())
              .filter(Boolean)
          )
          setMetricLoadError("")
        } else {
          console.error(metricsResult.reason)
          setMetricColumns([])
          setMetricLoadError(
            metricsResult.reason instanceof Error &&
              metricsResult.reason.message
              ? metricsResult.reason.message
              : "Could not load metrics for this decision."
          )
        }
        setMetricsLoading(false)
      } catch (error) {
        if (ignoreResult) {
          return
        }

        if (isDecisionUnavailableError(error)) {
          setDecision(null)
          setLoadError(
            "Decision not available."
          )
          return
        }

        console.error(error)
        setLoadError(
          getSaveErrorMessage(
            error,
            "Decision could not be loaded."
          )
        )
      }
    }

    load()
    return () => {
      ignoreResult = true
      activeTimelineDecisionId.current = null
    }
  }, [
    loadRetryKey,
    metricLoadRetryKey,
    params.id,
    activeWorkspaceId,
    user?.id,
    workspaceVersion,
  ])

  useEffect(() => {
    const expectedOutcome =
      decision?.expected_outcome?.trim()
    const actualOutcome =
      decision?.actual_outcome?.trim()

    if (
      !user?.id ||
      !decision?.id ||
      !canManageWorkspaceData ||
      !expectedOutcome ||
      !actualOutcome
    ) {
      queueMicrotask(() => {
        setOutcomeAnalysis(null)
        setOutcomeAnalysisLoading(false)
        setOutcomeAnalysisError(false)
      })
      return
    }

    const decisionId = decision.id
    const userId = user.id
    let ignoreResult = false

    queueMicrotask(() => {
      setOutcomeAnalysisLoading(true)
      setOutcomeAnalysisError(false)
    })

    async function loadOutcomeAnalysis() {
      try {
        const result =
          await getDecisionOutcomeAnalysis(
            decisionId,
            userId,
            activeWorkspaceId
          )

        if (!ignoreResult) {
          setOutcomeAnalysis(
            result.ai_analysis
          )
        }
      } catch {
        if (!ignoreResult) {
          setOutcomeAnalysis(null)
          setOutcomeAnalysisError(true)
        }
      } finally {
        if (!ignoreResult) {
          setOutcomeAnalysisLoading(false)
        }
      }
    }

    void loadOutcomeAnalysis()

    return () => {
      ignoreResult = true
    }
  }, [
    activeWorkspaceId,
    decision?.actual_outcome,
    decision?.expected_outcome,
    decision?.id,
    decision?.outcome_status,
    canManageWorkspaceData,
    outcomeAnalysisRetryKey,
    user?.id,
  ])

  async function loadActivities(
    decisionId: number,
    userId: string,
    workspaceId: string,
    isCurrent: () => boolean = () => true
  ) {
    try {
      setActivitiesLoading(true)
      setActivityLoadError("")

      const data =
        await getDecisionActivities(
          decisionId,
          userId,
          workspaceId,
          timelineActivityPageSize,
          0
        )

      if (!isCurrent()) {
        return
      }

      setActivities(data)
      setHasMoreActivities(
        data.length === timelineActivityPageSize
      )
    } catch (error) {
      if (!isCurrent()) {
        return
      }

      console.error(error)
      setActivities([])
      setHasMoreActivities(false)
      setActivityLoadError(
        getSaveErrorMessage(
          error,
          "Decision timeline could not be loaded."
        )
      )
    } finally {
      if (isCurrent()) {
        setActivitiesLoading(false)
      }
    }
  }

  /* =========================
     Decision Timeline Pagination For Long Detail Activity Histories
  ========================= */

  async function handleLoadMoreActivities() {
    if (
      !user?.id ||
      !decision ||
      activitiesLoading
    ) {
      return
    }

    setActivitiesLoading(true)
    setActivityLoadError("")
    const timelineDecisionId = decision.id

    try {
      const data =
        await getDecisionActivities(
          decision.id,
          user.id,
          activeWorkspaceId,
          timelineActivityPageSize,
          activities.length
        )

      if (
        activeTimelineDecisionId.current !==
        timelineDecisionId
      ) {
        return
      }

      setActivities([
        ...activities,
        ...data,
      ])

      setHasMoreActivities(
        data.length === timelineActivityPageSize
      )
    } catch (error) {
      if (
        activeTimelineDecisionId.current !==
        timelineDecisionId
      ) {
        return
      }

      console.error(error)
      setActivityLoadError(
        getSaveErrorMessage(
          error,
          "More timeline events could not be loaded."
        )
      )
    } finally {
      if (
        activeTimelineDecisionId.current ===
        timelineDecisionId
      ) {
        setActivitiesLoading(false)
      }
    }
  }

  async function handleRetryActivities() {
    if (
      !user?.id ||
      !decision ||
      activitiesLoading
    ) {
      return
    }

    await loadActivities(
      decision.id,
      user.id,
      activeWorkspaceId
    )
  }

  /* =========================
     Decision Detail Section Error Clearing For Follow Up Edits
  ========================= */

  function clearSaveErrorForSection(
    section: SaveSection
  ) {
    if (saveError?.section === section) {
      setSaveError(null)
    }
  }

  /* =========================
     Decision Overview Form Sync Helper For Save Archive And Restore Responses
  ========================= */

  function syncOverviewFormFromDecision(
    nextDecision: DecisionRecord
  ) {
    setStatus(nextDecision.status ?? defaultDecisionStatus)
    setOriginalStatus(nextDecision.status ?? defaultDecisionStatus)
    setPriority(nextDecision.priority ?? defaultDecisionPriority)
    setOriginalPriority(nextDecision.priority ?? defaultDecisionPriority)
    setCategory(nextDecision.category ?? defaultDecisionCategory)
    setOriginalCategory(nextDecision.category ?? defaultDecisionCategory)
    setConfidenceScore(nextDecision.confidence_score ?? "")
    setOriginalConfidenceScore(nextDecision.confidence_score ?? "")

    const nextReviewDate =
      nextDecision.review_date
        ? nextDecision.review_date.split("T")[0]
        : ""

    setReviewDate(nextReviewDate)
    setOriginalReviewDate(nextReviewDate)
  }

  /* =========================
     Decision Details Form Sync Helper For Load And Save Responses
  ========================= */

  function syncDetailsFormFromDecision(
    nextDecision: DecisionRecord
  ) {
    setTitle(nextDecision.title ?? "")
    setOriginalTitle(nextDecision.title ?? "")
    setDescription(nextDecision.description ?? "")
    setOriginalDescription(nextDecision.description ?? "")
    setMetricColumn(nextDecision.metric_column ?? "")
    setOriginalMetricColumn(nextDecision.metric_column ?? "")
  }

  /* =========================
     Decision Outcome Form Sync Helper For Load And Save Responses
  ========================= */

  function syncOutcomeFormFromDecision(
    nextDecision: DecisionRecord
  ) {
    setExpectedOutcome(nextDecision.expected_outcome ?? "")
    setOriginalExpectedOutcome(nextDecision.expected_outcome ?? "")
    setActualOutcome(nextDecision.actual_outcome ?? "")
    setOriginalActualOutcome(nextDecision.actual_outcome ?? "")
    setOutcomeStatus(nextDecision.outcome_status ?? "")
    setOriginalOutcomeStatus(nextDecision.outcome_status ?? "")
  }

  /* =========================
     Decision Notes Form Sync Helper For Load And Save Responses
  ========================= */

  function syncNotesFormFromDecision(
    nextDecision: DecisionRecord
  ) {
    setNotes(nextDecision.notes ?? "")
    setOriginalNotes(nextDecision.notes ?? "")
  }

  /* =========================
     Decision Learning Form Sync Helper For Load And Save Responses
  ========================= */

  function syncLearningFormFromDecision(
    nextDecision: DecisionRecord
  ) {
    setLessonsLearned(nextDecision.lessons_learned ?? "")
    setOriginalLessonsLearned(nextDecision.lessons_learned ?? "")
  }

  const statusChanged =
    status !== originalStatus

  const priorityChanged =
    priority !== originalPriority

  const categoryChanged =
    category !== originalCategory

  const reviewDateChanged =
    reviewDate !== originalReviewDate

  const confidenceScoreChanged =
    confidenceScore !== originalConfidenceScore

  const detailsChanged =
    title !== originalTitle ||
    description !== originalDescription ||
    metricColumn !== originalMetricColumn

  const overviewChanged =
    statusChanged ||
    priorityChanged ||
    categoryChanged ||
    confidenceScoreChanged ||
    reviewDateChanged

  const noteChanged =
    notes !== originalNotes

  const outcomeChanged =
    expectedOutcome !== originalExpectedOutcome ||
    actualOutcome !== originalActualOutcome ||
    outcomeStatus !== originalOutcomeStatus

  const expectedOutcomeMissing =
    expectedOutcome.trim().length === 0

  const learningChanged =
    lessonsLearned !== originalLessonsLearned

  async function handleSaveDetails() {
    if (!user?.id || !decision) return

    setSavingSection(detailsDecisionActivity)
    setSaveError(null)

    try {
      const detailsPayload: DecisionDetailsPayload = {}

      if (title !== originalTitle) {
        detailsPayload.title = title
      }

      if (description !== originalDescription) {
        detailsPayload.description = description
      }

      if (metricColumn !== originalMetricColumn) {
        detailsPayload.metric_column = metricColumn || null
      }

      const data = await updateDecisionDetails(
        decision.id,
        detailsPayload,
        user.id,
        activeWorkspaceId
      )

      setDecision(data)
      syncDetailsFormFromDecision(
        data
      )
      await loadActivities(
        data.id,
        user.id,
        activeWorkspaceId
      )
      showSectionSaved(
        detailsDecisionActivity,
        setDetailsSaved
      )
    } catch (error) {
      console.error(error)
      setSaveError({
        section: detailsDecisionActivity,
        message: getSaveErrorMessage(
          error,
          "Decision details could not be saved."
        ),
      })
    } finally {
      setSavingSection(null)
    }
  }

  async function handleSaveOverview() {
    if (!user?.id || !decision) return

    setSavingSection(overviewDecisionActivity)
    setSaveError(null)

    try {
      const overviewPayload: DecisionOverviewPayload = {}

      if (status !== originalStatus) {
        overviewPayload.status = status
      }

      if (priority !== originalPriority) {
        overviewPayload.priority = priority
      }

      if (category !== originalCategory) {
        overviewPayload.category = category
      }

      if (confidenceScore !== originalConfidenceScore) {
        overviewPayload.confidence_score =
          confidenceScore || null
      }

      if (reviewDate !== originalReviewDate) {
        overviewPayload.review_date = reviewDate
          ? `${reviewDate}T00:00:00`
          : null
      }

      const updatedDecision = await updateDecisionOverview(
        decision.id,
        overviewPayload,
        user.id,
        activeWorkspaceId
      )

      setDecision(updatedDecision)
      syncOverviewFormFromDecision(
        updatedDecision
      )
      await loadActivities(
        updatedDecision.id,
        user.id,
        activeWorkspaceId
      )
      showSectionSaved(
        overviewDecisionActivity,
        setOverviewSaved
      )
    } catch (error) {
      console.error(error)
      setSaveError({
        section: overviewDecisionActivity,
        message: getSaveErrorMessage(
          error,
          "Decision overview could not be saved."
        ),
      })
    } finally {
      setSavingSection(null)
    }
  }

  function handleSetReviewDateOffset(days: number) {
    clearSaveErrorForSection(overviewDecisionActivity)
    setOverviewSaved(false)
    setReviewDate(
      getDateInputValueFromToday(days)
    )
  }

  async function handleSaveNote() {
    if (!user?.id || !decision) return

    setSavingSection(notesDecisionActivity)
    setSaveError(null)

    try {
      const data = await updateDecisionNotes(
        decision.id,
        notes,
        user.id,
        activeWorkspaceId
      )

      setDecision(data)
      syncNotesFormFromDecision(
        data
      )
      await loadActivities(
        data.id,
        user.id,
        activeWorkspaceId
      )
      showSectionSaved(
        notesDecisionActivity,
        setNoteSaved
      )
    } catch (error) {
      console.error(error)
      setSaveError({
        section: notesDecisionActivity,
        message: getSaveErrorMessage(
          error,
          "Decision notes could not be saved."
        ),
      })
    } finally {
      setSavingSection(null)
    }
  }

  async function handleSaveOutcome() {
    if (!user?.id || !decision) return

    const cleanExpectedOutcome =
      expectedOutcome.trim()

    if (!cleanExpectedOutcome) {
      setSaveError({
        section: outcomeDecisionActivity,
        message: "Expected outcome is required before saving outcome tracking.",
      })
      return
    }

    setSavingSection(outcomeDecisionActivity)
    setSaveError(null)

    try {
      const outcomePayload: DecisionOutcomePayload = {}

      if (expectedOutcome !== originalExpectedOutcome) {
        outcomePayload.expected_outcome = cleanExpectedOutcome
      }

      if (actualOutcome !== originalActualOutcome) {
        outcomePayload.actual_outcome = actualOutcome
      }

      if (outcomeStatus !== originalOutcomeStatus) {
        outcomePayload.outcome_status =
          outcomeStatus || null
      }

      const data = await updateDecisionOutcome(
        decision.id,
        outcomePayload,
        user.id,
        activeWorkspaceId
      )

      setDecision(data)
      syncOutcomeFormFromDecision(
        data
      )
      setOutcomeAnalysis(null)
      setOutcomeAnalysisError(false)
      await loadActivities(
        data.id,
        user.id,
        activeWorkspaceId
      )
      showSectionSaved(
        outcomeDecisionActivity,
        setOutcomeSaved
      )
    } catch (error) {
      console.error(error)
      setSaveError({
        section: outcomeDecisionActivity,
        message: getSaveErrorMessage(
          error,
          "Decision outcome could not be saved."
        ),
      })
    } finally {
      setSavingSection(null)
    }
  }

  async function handleSaveLearning() {
    if (!user?.id || !decision) return

    setSavingSection(learningDecisionActivity)
    setSaveError(null)

    try {
      const data = await updateDecisionLearning(
        decision.id,
        lessonsLearned,
        user.id,
        activeWorkspaceId
      )

      setDecision(data)
      syncLearningFormFromDecision(
        data
      )
      await loadActivities(
        data.id,
        user.id,
        activeWorkspaceId
      )
      showSectionSaved(
        learningDecisionActivity,
        setLearningSaved
      )
    } catch (error) {
      console.error(error)
      setSaveError({
        section: learningDecisionActivity,
        message: getSaveErrorMessage(
          error,
          "Decision learning could not be saved."
        ),
      })
    } finally {
      setSavingSection(null)
    }
  }

  function handleAddLearningPrompt(prompt: string) {
    clearSaveErrorForSection(learningDecisionActivity)
    setLearningSaved(false)
    setLessonsLearned(currentValue => {
      const cleanCurrentValue =
        currentValue.trim()

      return cleanCurrentValue
        ? `${cleanCurrentValue}\n\n${prompt}`
        : prompt
    })
  }

  function handleApplyOutcomeRecommendation() {
    const recommendation =
      outcomeAnalysis?.recommendations[0]

    if (!recommendation) {
      return
    }

    const learningEntry =
      `AI outcome review: ${recommendation}`
    if (lessonsLearned.includes(learningEntry)) {
      return
    }

    handleAddLearningPrompt(
      learningEntry
    )

    window.setTimeout(() => {
      const learningField =
        document.getElementById(
          "decision-lessons-learned"
        )

      learningField?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      })

      if (learningField instanceof HTMLTextAreaElement) {
        learningField.focus()
      }
    }, 0)
  }

  function handleAddNotePrompt(prompt: string) {
    clearSaveErrorForSection(notesDecisionActivity)
    setNoteSaved(false)
    setNotes(currentValue => {
      const cleanCurrentValue =
        currentValue.trim()

      return cleanCurrentValue
        ? `${cleanCurrentValue}\n\n${prompt}`
        : prompt
    })
  }

  async function handleArchiveDecision() {
    if (!user?.id || !decision) return

    setSavingSection(archiveDecisionActivity)
    setSaveError(null)
    setRestoreSaved(false)

    try {
      const data = await archiveDecision(
        decision.id,
        user.id,
        activeWorkspaceId
      )

      setDecision(data)
      syncOverviewFormFromDecision(
        data
      )
      await loadActivities(
        data.id,
        user.id,
        activeWorkspaceId
      )
      showSectionSaved(
        archiveDecisionActivity,
        setArchiveSaved
      )
    } catch (error) {
      console.error(error)
      setSaveError({
        section: archiveDecisionActivity,
        message: getSaveErrorMessage(
          error,
          "Decision could not be archived."
        ),
      })
    } finally {
      setSavingSection(null)
    }
  }

  async function handleRestoreDecision() {
    if (!user?.id || !decision) return

    setSavingSection(restoreDecisionActivity)
    setSaveError(null)
    setArchiveSaved(false)

    try {
      const data = await restoreDecision(
        decision.id,
        user.id,
        activeWorkspaceId
      )

      setDecision(data)
      syncOverviewFormFromDecision(
        data
      )
      await loadActivities(
        data.id,
        user.id,
        activeWorkspaceId
      )
      showSectionSaved(
        restoreDecisionActivity,
        setRestoreSaved
      )
    } catch (error) {
      console.error(error)
      setSaveError({
        section: restoreDecisionActivity,
        message: getSaveErrorMessage(
          error,
          "Decision could not be restored."
        ),
      })
    } finally {
      setSavingSection(null)
    }
  }

  const decisionUnavailable =
    loadError === "Decision not available."
  const nextActionTarget =
    decision
      ? getNextActionTarget(decision)
      : null
  const nextActionFocusKey =
    decision && nextActionTarget
      ? `${decision.id}:${nextActionTarget.elementId}`
      : null

  useEffect(() => {
    if (
      !decision ||
      !nextActionTarget ||
      !nextActionFocusKey ||
      !shouldFocusNextAction ||
      lastAutoFocusedDecisionKey.current === nextActionFocusKey
    ) {
      return
    }

    lastAutoFocusedDecisionKey.current = nextActionFocusKey

    const timeoutId = window.setTimeout(() => {
      focusNextActionTarget(nextActionTarget)
    }, 100)

    return () => window.clearTimeout(timeoutId)
  }, [
    decision,
    nextActionTarget,
    nextActionFocusKey,
    shouldFocusNextAction,
  ])

  if (!decision && loadError) {
    return (
      <DashboardCard>
        {/* =========================
            Decision Detail Load Error State For Missing Or Inaccessible Records
        ========================= */}

        <div className="space-y-3">
          <Link
            href="/dashboard/decisions"
            className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft size={16} />
            Back to Decisions
          </Link>

          <p
            role={decisionUnavailable ? "status" : "alert"}
            className={`text-sm font-medium ${
              decisionUnavailable
                ? "text-gray-700"
                : "text-red-600"
            }`}
          >
            {loadError}
          </p>

          {!decisionUnavailable && (
            <button
              type="button"
              onClick={() => setLoadRetryKey(
                currentKey => currentKey + 1
              )}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition hover:border-[var(--decisionate-brand-primary-ring)] hover:text-[var(--decisionate-brand-primary-text)]"
            >
              Try Again
            </button>
          )}
        </div>

      </DashboardCard>
    )
  }

  if (!decision) {
    return (
      <DashboardCard>
        {/* =========================
            Decision Detail Loading State While Record Fetch Is In Progress
        ========================= */}

        <p
          role="status"
          aria-live="polite"
          className="text-sm text-gray-500"
        >
          Loading decision...
        </p>
      </DashboardCard>
    )
  }

  const outcomeRecorded =
    hasRecordedOutcome(decision)
  const outcomePending =
    hasPendingOutcome(decision)
  const nextAction =
    getNextAction(decision)

  const healthItems = [
    outcomeRecorded,
    hasCapturedLearning(decision),
    Boolean(decision.review_date),
    hasAddedNotes(decision),
  ]

  const completedHealthItems =
    healthItems.filter(Boolean).length

  const healthScore =
    Math.round(
      (completedHealthItems / healthItems.length) * 100
    )

  const reviewDateValue =
    getDecisionDateValue(
      decision.review_date
    )

  const reviewUrgency =
    getReviewUrgency(
      reviewDateValue
    )
  const actionQueueWorkRemaining =
    hasPendingOutcome(decision) ||
    hasPendingLearning(decision) ||
    hasOverdueReview(decision)

  const healthStatusLabel =
    getDecisionHealth(decision)

  const isArchivedDecision =
    decision.status === archivedDecisionStatus
  const decisionIsReadOnly =
    !canManageWorkspaceData

  const detailsSaveDisabled =
    getSectionSaveDisabled({
      isArchived: isArchivedDecision,
      savingSection,
      section: detailsDecisionActivity,
      changed: detailsChanged,
      invalid: title.trim().length === 0,
    })

  const outcomeSaveDisabled =
    getSectionSaveDisabled({
      isArchived: isArchivedDecision,
      savingSection,
      section: outcomeDecisionActivity,
      changed: outcomeChanged,
      invalid: expectedOutcomeMissing,
    })

  const overviewSaveDisabled =
    getSectionSaveDisabled({
      isArchived: isArchivedDecision,
      savingSection,
      section: overviewDecisionActivity,
      changed: overviewChanged,
    })

  const noteSaveDisabled =
    getSectionSaveDisabled({
      isArchived: isArchivedDecision,
      savingSection,
      section: notesDecisionActivity,
      changed: noteChanged,
    })

  const learningSaveDisabled =
    getSectionSaveDisabled({
      isArchived: isArchivedDecision,
      savingSection,
      section: learningDecisionActivity,
      changed: learningChanged,
    })
  const backToDecisionsHref =
    showActionQueueBackLink
      ? "/dashboard/action-needed"
      : "/dashboard/decisions"
  const backToDecisionsLabel =
    showActionQueueBackLink
      ? "Back to Action Needed"
      : "Back to Decisions"
  const decisionDatasetLabel =
    formatDecisionDatasetLabel(
      dataset,
      decision.dataset_id
    )
  const aiRecommendationSource =
    getAIRecommendationSource(
      decision.description
    )

  return (
    <div className="space-y-6">
      <Link
        href={backToDecisionsHref}
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft size={16} />
        {backToDecisionsLabel}
      </Link>

      <WorkspaceAccessNotice
        loading={loadingWorkspaceAccess}
        canManageWorkspaceData={!decisionIsReadOnly}
        message="This client workspace is read-only. Decision changes are managed by the workspace team."
        className="rounded-xl"
      />

      <DashboardCard>
        {/* =========================
            Decision Detail Header With Status Dataset And Review Badges
        ========================= */}

        <DashboardPageHeader
          title={decision.title}
          description={decision.description || "No description provided."}
          actions={
            <IconBadge
              className={
                isArchivedDecision
                  ? "bg-gray-100 text-gray-600"
                  : "bg-[var(--decisionate-brand-primary-soft)] text-[var(--decisionate-brand-primary-text)]"
              }
              icon={<Target size={26} />}
              large
            />
          }
        />

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge className="border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] text-[var(--decisionate-brand-primary-text)]">
            Status: {formatDecisionLabel(decision.status)}
          </Badge>

          <Badge className={getReviewUrgencyClass(reviewUrgency)}>
            {reviewUrgency}
          </Badge>

          <Link
            href={`/dashboard/datasets/${decision.dataset_id}`}
            title={decisionDatasetLabel}
            className="inline-block max-w-full truncate rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-sm font-medium text-gray-700 transition hover:border-[var(--decisionate-brand-primary-ring)] hover:bg-[var(--decisionate-brand-primary-soft)] hover:text-[var(--decisionate-brand-primary-text)]"
          >
            Dataset:{" "}
            {decisionDatasetLabel}
          </Link>

          {decision.metric_column && (
            <Badge className="border-gray-200 bg-gray-50 text-gray-700">
              Metric: {formatMetricLabel(decision.metric_column)}
            </Badge>
          )}

          {aiRecommendationSource && (
            <Badge className="border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] text-[var(--decisionate-brand-primary-text)]">
              Analysis source: {aiRecommendationSource}
            </Badge>
          )}
        </div>
      </DashboardCard>

      {/* =========================
          Decision Lifecycle Card For Archive And Restore Actions
      ========================= */}

      <DashboardCard>
        <CardHeader
          title="Decision Lifecycle"
          description="Move decisions between active work and archived history."
          icon={
            archiveSaved || restoreSaved ? (
              <SavedBadge
                label={archiveSaved ? "Archived" : "Restored"}
              />
            ) : (
              <IconBadge
                className="bg-gray-100 text-gray-600"
                icon={<Archive size={22} />}
              />
            )
          }
        />

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">
              {isArchivedDecision
                ? "Restore this decision"
                : "Archive this decision"}
            </p>

            <p className="mt-1 text-sm text-gray-500">
              {isArchivedDecision
                ? "Restored decisions return to active portfolio management."
                : "Archived decisions remain visible in the portfolio and timeline."}
            </p>
          </div>

          <button
            type="button"
            onClick={
              isArchivedDecision
                ? handleRestoreDecision
                : handleArchiveDecision
            }
            disabled={
              decisionIsReadOnly ||
              savingSection === archiveDecisionActivity ||
              savingSection === restoreDecisionActivity
            }
            className={getArchiveButtonClass(
              savingSection === archiveDecisionActivity ||
                savingSection === restoreDecisionActivity
            )}
          >
            {savingSection === archiveDecisionActivity
              ? "Archiving..."
              : savingSection === restoreDecisionActivity
                ? "Restoring..."
                : isArchivedDecision
                  ? "Restore to Active"
                  : "Archive Decision"}
          </button>
        </div>

        <SaveFeedback
          section={archiveDecisionActivity}
          savingSection={savingSection}
          saveError={saveError}
        />

        <SaveFeedback
          section={restoreDecisionActivity}
          savingSection={savingSection}
          saveError={saveError}
        />
      </DashboardCard>

      {/* =========================
          Decision Details Editable Title And Description Section
      ========================= */}

      <DashboardCard>
        {/* =========================
            Decision Details Form Inputs And Save Action
        ========================= */}

        <CardHeader
          title="Decision Details"
          description={
            dataset
              ? `${dataset.row_count} rows, ${dataset.column_count} columns • ${getDatasetSourceDetails(
                  dataset.source_type,
                  dataset.source_config,
                  dataset.source_label
                ).label}`
              : "Update the decision title and summary."
          }
          icon={
            detailsSaved ? (
              <SavedBadge />
            ) : (
              <IconBadge
                className="bg-[var(--decisionate-brand-primary-soft)] text-[var(--decisionate-brand-primary-text)]"
                icon={<ClipboardList size={22} />}
              />
            )
          }
        />

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)]">
          <Field label="Title">
            <input
              aria-label="Decision title"
              value={title}
              disabled={decisionIsReadOnly || isArchivedDecision}
              onChange={(e) => {
                clearSaveErrorForSection(detailsDecisionActivity)
                setDetailsSaved(false)
                setTitle(e.target.value)
              }}
              className={inputClass}
            />
          </Field>

          <Field label="Metric">
            <MetricSelector
              ariaLabel="Decision metric"
              metrics={metricColumn && !metricColumns.includes(metricColumn)
                ? [metricColumn, ...metricColumns]
                : metricColumns}
              value={metricColumn || undefined}
              loadError={Boolean(metricLoadError)}
              disabled={
                isArchivedDecision ||
                metricsLoading ||
                metricColumns.length === 0
              }
              placeholder={
                metricsLoading
                  ? "Loading metrics..."
                  : metricColumns.length === 0
                    ? "No numeric metrics"
                    : "No metric selected"
              }
              onChange={(metric) => {
                clearSaveErrorForSection(detailsDecisionActivity)
                setDetailsSaved(false)
                setMetricColumn(metric ?? "")
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
                    setMetricLoadRetryKey(currentKey => currentKey + 1)
                  }
                  className="w-fit rounded-md border border-red-200 bg-white px-2 py-1 font-medium text-red-700 transition hover:bg-red-100"
                >
                  Retry metrics
                </button>
              </div>
            )}
          </Field>

          <Field label="Description">
            <textarea
              aria-label="Decision description"
              value={description}
              disabled={decisionIsReadOnly || isArchivedDecision}
              onChange={(e) => {
                clearSaveErrorForSection(detailsDecisionActivity)
                setDetailsSaved(false)
                setDescription(e.target.value)
              }}
              rows={3}
              className={textareaClass}
            />
          </Field>
        </div>

        <SectionSaveActions
          section={detailsDecisionActivity}
          savingSection={savingSection}
          saveError={saveError}
          isArchived={isArchivedDecision}
          disabled={decisionIsReadOnly || detailsSaveDisabled}
          label="Save Details"
          onClick={handleSaveDetails}
        >

          {!isArchivedDecision && title.trim().length === 0 && (
            <p className="mt-2 text-sm font-medium text-amber-700">
              Decision title is required.
            </p>
          )}
        </SectionSaveActions>
      </DashboardCard>

      {/* =========================
          Decision Health Completion Score And Next Action Section
      ========================= */}

      <DashboardCard>
        <CardHeader
          title="Decision Health"
          description="Lifecycle health with documentation completeness across outcome, learning, review schedule and notes."
          icon={
            <IconBadge
              className={getHealthIconClass(
                healthStatusLabel
              )}
              icon={<HeartPulse size={22} />}
            />
          }
        />

        <div className="mt-4">
          <p className="text-3xl font-bold">
            {getHealthScoreDisplay(
              healthStatusLabel,
              healthScore
            )}
          </p>

          <div className="mt-1 flex items-center gap-2">
            <p className="text-sm text-gray-500">
              {getHealthRequirementDisplay(
                healthStatusLabel,
                completedHealthItems,
                healthItems.length
              )}
            </p>

            <HealthLevelBadge
              statusLabel={healthStatusLabel}
            />
          </div>

          <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full rounded-full ${getHealthProgressClass(
                healthStatusLabel,
                healthScore
              )}`}
              style={{
                width: `${healthScore}%`,
              }}
            />
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-5">
          <HealthItem
            title="Outcome"
            complete={outcomeRecorded}
            muted={healthStatusLabel === archivedDecisionHealthLabel}
            value={
              decision.outcome_status
                ? formatDecisionLabel(decision.outcome_status)
                : outcomeRecorded
                  ? "Actual Recorded"
                  : outcomePending
                    ? "Outcome Pending"
                : "Not Recorded"
            }
          />

          <HealthItem
            title="Learning"
            complete={hasCapturedLearning(decision)}
            muted={healthStatusLabel === archivedDecisionHealthLabel}
            value={
              hasCapturedLearning(decision)
                ? "Captured"
                : "Not Captured"
            }
          />

          <HealthItem
            title="Review"
            complete={Boolean(decision.review_date)}
            muted={healthStatusLabel === archivedDecisionHealthLabel}
            value={
              decision.review_date
                ? reviewUrgency === "Review Overdue"
                  ? `Overdue: ${formatDecisionDate(decision.review_date)}`
                  : formatDecisionDate(decision.review_date)
                : "Not Scheduled"
            }
          />

          <HealthItem
            title="Notes"
            complete={hasAddedNotes(decision)}
            muted={healthStatusLabel === archivedDecisionHealthLabel}
            value={
              hasAddedNotes(decision)
                ? "Added"
                : "Not Added"
            }
          />

          <HealthItem
            title="Confidence"
            complete={Boolean(decision.confidence_score)}
            muted={healthStatusLabel === archivedDecisionHealthLabel}
            optional
            value={formatDecisionLabel(
              decision.confidence_score
            )}
          />
        </div>

        <div className="mt-4 rounded-xl border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--decisionate-brand-primary-text)]">
            Next Action
          </p>

          <p className="mt-1 text-sm text-[var(--decisionate-brand-primary-text)]">
            {nextAction}
          </p>

          {nextActionTarget && (
            <button
              type="button"
              onClick={() => focusNextActionTarget(nextActionTarget)}
              className="mt-3 rounded-lg border border-[var(--decisionate-brand-primary-ring)] bg-white px-3 py-2 text-sm font-medium text-[var(--decisionate-brand-primary-text)] transition hover:bg-[var(--decisionate-brand-primary-soft)]"
            >
              {nextActionTarget.label}
            </button>
          )}

          {showActionQueueBackLink && (
            <div className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
              actionQueueWorkRemaining
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-green-200 bg-green-50 text-green-800"
            }`}
            >
              <p>
                {actionQueueWorkRemaining
                  ? "This decision still has Action Needed work."
                  : "This decision is clear for the Action Needed queue."}
              </p>

              <Link
                href="/dashboard/action-needed"
                className="mt-2 inline-flex font-medium text-[var(--decisionate-brand-primary-text)] hover:opacity-80"
              >
                Back to Action Needed →
              </Link>
            </div>
          )}
        </div>
      </DashboardCard>

      {/* =========================
          Decision Outcome And Overview Editable Cards
      ========================= */}

      <div className="grid gap-6 xl:grid-cols-2">
        <DashboardCard className="flex h-full flex-col">
          <CardHeader
            title="Outcome Tracking"
            description="Compare expected results with what actually happened."
            icon={
              outcomeSaved ? (
                <SavedBadge />
              ) : (
                <IconBadge
                  className="bg-green-50 text-green-600"
                  icon={<Target size={22} />}
                />
              )
            }
          />

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Field label="Expected Outcome" required>
              <textarea
                id="decision-expected-outcome"
                aria-label="Expected outcome"
                value={expectedOutcome}
                disabled={decisionIsReadOnly || isArchivedDecision}
                onChange={(e) => {
                  clearSaveErrorForSection(outcomeDecisionActivity)
                  setOutcomeSaved(false)
                  setExpectedOutcome(e.target.value)
                }}
                rows={4}
                className={textareaClass}
              />
            </Field>

            <Field label="Actual Outcome">
              <textarea
                id="decision-actual-outcome"
                aria-label="Actual outcome"
                value={actualOutcome}
                disabled={decisionIsReadOnly || isArchivedDecision}
                onChange={(e) => {
                  clearSaveErrorForSection(outcomeDecisionActivity)
                  setOutcomeSaved(false)
                  setActualOutcome(e.target.value)
                }}
                rows={4}
                className={textareaClass}
              />
            </Field>
          </div>

          <Field
            label="Outcome Status"
            className="mt-4"
          >
            <select
              id="decision-outcome-status"
              aria-label="Outcome status"
              value={outcomeStatus}
              disabled={decisionIsReadOnly || isArchivedDecision}
              onChange={(e) => {
                clearSaveErrorForSection(outcomeDecisionActivity)
                setOutcomeSaved(false)
                setOutcomeStatus(
                  e.target.value as DecisionOutcomeStatusFormValue
                )
              }}
              className={inputClass}
            >
              <option value="">
                Select status
              </option>
              {decisionOutcomeStatusOptions.map(
                (option) => (
                  <option
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </option>
                )
              )}
            </select>

            <div className="mt-2 flex flex-wrap gap-2">
              {decisionOutcomeStatusOptions.map(option => (
                <button
                  key={option.value}
                  type="button"
                  disabled={decisionIsReadOnly || isArchivedDecision}
                  onClick={() => {
                    clearSaveErrorForSection(outcomeDecisionActivity)
                    setOutcomeStatus(option.value)
                  }}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-400 ${
                    outcomeStatus === option.value
                      ? "border-green-200 bg-green-100 text-green-800"
                      : "border-green-100 bg-green-50 text-green-700 hover:bg-green-100"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </Field>

          <SectionSaveActions
            section={outcomeDecisionActivity}
            savingSection={savingSection}
            saveError={saveError}
            isArchived={isArchivedDecision}
            disabled={decisionIsReadOnly || outcomeSaveDisabled}
            label="Save Outcome"
            onClick={handleSaveOutcome}
          >
            {!isArchivedDecision && expectedOutcomeMissing && (
              <p className="mt-2 text-sm font-medium text-amber-700">
                Expected outcome is required so this decision keeps a measurable review target.
              </p>
            )}
          </SectionSaveActions>
        </DashboardCard>

        <DashboardCard className="flex h-full flex-col">
          <CardHeader
            title="Decision Overview"
            description="Manage decision status, priority, category, confidence and review schedule."
            icon={
              overviewSaved ? (
                <SavedBadge />
              ) : (
                <IconBadge
                  className="bg-[var(--decisionate-brand-primary-soft)] text-[var(--decisionate-brand-primary-text)]"
                  icon={<ClipboardList size={22} />}
                />
              )
            }
          />

          <div className="mt-4 grid gap-x-6 gap-y-4 md:grid-cols-2">
            <Field label="Status">
              <select
                aria-label="Decision status"
                value={status}
                disabled={decisionIsReadOnly || isArchivedDecision}
                onChange={(e) => {
                  clearSaveErrorForSection(overviewDecisionActivity)
                  setOverviewSaved(false)
                  setStatus(
                    e.target.value as DecisionStatus
                  )
                }}
                className={inputClass}
              >
                {decisionStatusOptions.map(
                  (option) => (
                    <option
                      key={option.value}
                      value={option.value}
                    >
                      {option.label}
                    </option>
                  )
                )}
              </select>
            </Field>

            <Field label="Priority">
              <select
                aria-label="Decision priority"
                value={priority}
                disabled={decisionIsReadOnly || isArchivedDecision}
                onChange={(e) => {
                  clearSaveErrorForSection(overviewDecisionActivity)
                  setOverviewSaved(false)
                  setPriority(
                    e.target.value as DecisionPriority
                  )
                }}
                className={inputClass}
              >
                {decisionPriorityOptions.map(
                  (option) => (
                    <option
                      key={option.value}
                      value={option.value}
                    >
                      {option.label}
                    </option>
                  )
                )}
              </select>
            </Field>

            <Field label="Category">
              <select
                aria-label="Decision category"
                value={category}
                disabled={decisionIsReadOnly || isArchivedDecision}
                onChange={(e) => {
                  clearSaveErrorForSection(overviewDecisionActivity)
                  setOverviewSaved(false)
                  setCategory(
                    e.target.value as DecisionCategory
                  )
                }}
                className={inputClass}
              >
                {decisionCategoryOptions.map(
                  (option) => (
                    <option
                      key={option.value}
                      value={option.value}
                    >
                      {option.label}
                    </option>
                  )
                )}
              </select>
            </Field>

            <Field label="Confidence">
              <select
                id="decision-confidence-score"
                aria-label="Decision confidence"
                value={confidenceScore}
                disabled={decisionIsReadOnly || isArchivedDecision}
                onChange={(e) => {
                  clearSaveErrorForSection(overviewDecisionActivity)
                  setOverviewSaved(false)
                  setConfidenceScore(
                    e.target.value as DecisionConfidenceFormValue
                  )
                }}
                className={inputClass}
              >
                <option value="">Not Set</option>
                {decisionConfidenceOptions.map(
                  (option) => (
                    <option
                      key={option.value}
                      value={option.value}
                    >
                      {option.label}
                    </option>
                  )
                )}
              </select>
            </Field>

            <Field label="Review Date">
              <input
                id="decision-review-date"
                aria-label="Decision review date"
                type="date"
                value={reviewDate}
                disabled={decisionIsReadOnly || isArchivedDecision}
                onChange={(e) => {
                  clearSaveErrorForSection(overviewDecisionActivity)
                  setOverviewSaved(false)
                  setReviewDate(e.target.value)
                }}
                className={inputClass}
              />

              <div className="mt-2 flex flex-wrap gap-2">
                {reviewDateQuickActions.map(action => (
                  <button
                    key={action.days}
                    type="button"
                    disabled={decisionIsReadOnly || isArchivedDecision}
                    onClick={() => handleSetReviewDateOffset(action.days)}
                    className="rounded-full border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] px-3 py-1 text-xs font-medium text-[var(--decisionate-brand-primary-text)] transition hover:opacity-80 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-400"
                  >
                    In {action.label}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          <SectionSaveActions
            section={overviewDecisionActivity}
            savingSection={savingSection}
            saveError={saveError}
            isArchived={isArchivedDecision}
            disabled={decisionIsReadOnly || overviewSaveDisabled}
            label="Save Overview"
            onClick={handleSaveOverview}
          />
        </DashboardCard>
      </div>

      {outcomeAnalysisLoading && (
        <AnalysisStatus kind="loading" />
      )}

      {outcomeAnalysisError && (
        <AnalysisStatus
          kind="unavailable"
          onRetry={() =>
            setOutcomeAnalysisRetryKey(
              currentKey => currentKey + 1
            )
          }
        />
      )}

      {!outcomeAnalysisLoading && outcomeAnalysis && (
        <AIAnalysisPanel
          analysis={outcomeAnalysis}
          title="Outcome review"
          metric={decision.metric_column ?? undefined}
          className="rounded-2xl p-5 shadow-sm sm:p-6"
          onApplyRecommendation={
            !decisionIsReadOnly && !isArchivedDecision
              ? handleApplyOutcomeRecommendation
              : undefined
          }
          applyRecommendationLabel="Add recommendation to learning"
        />
      )}

      {/* =========================
          Decision Notes And Learning Capture Cards
      ========================= */}

      <div className="grid gap-6 lg:grid-cols-2">
        <DashboardCard className="flex h-full flex-col">
          <CardHeader
            title="Notes"
            description="Capture context, assumptions and supporting details."
            icon={
              noteSaved ? (
                <SavedBadge />
              ) : (
                <IconBadge
                  className="bg-amber-50 text-amber-600"
                  icon={<FileText size={22} />}
                />
              )
            }
          />

          <textarea
            id="decision-notes"
            aria-label="Decision notes"
            value={notes}
            disabled={decisionIsReadOnly || isArchivedDecision}
            onChange={(e) => {
              clearSaveErrorForSection(notesDecisionActivity)
              setNoteSaved(false)
              setNotes(e.target.value)
            }}
            rows={5}
            className={`mt-4 ${textareaClass.replace("mt-2 ", "")}`}
          />

          <div className="mt-2 flex flex-wrap gap-2">
            {decisionNotePrompts.map(prompt => (
              <button
                key={prompt.label}
                type="button"
                disabled={decisionIsReadOnly || isArchivedDecision}
                onClick={() => handleAddNotePrompt(prompt.text)}
                className="rounded-full border border-amber-100 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-400"
              >
                {prompt.label}
              </button>
            ))}
          </div>

          <SectionSaveActions
            section={notesDecisionActivity}
            savingSection={savingSection}
            saveError={saveError}
            isArchived={isArchivedDecision}
            disabled={decisionIsReadOnly || noteSaveDisabled}
            label="Save Note"
            onClick={handleSaveNote}
          />
        </DashboardCard>

        <DashboardCard className="flex h-full flex-col">
          <CardHeader
            title="Learning"
            description="Record what was learned so future decisions improve."
            icon={
              learningSaved ? (
                <SavedBadge />
              ) : (
                <IconBadge
                  className="bg-[var(--decisionate-brand-accent-soft)] text-[var(--decisionate-brand-accent-text)]"
                  icon={<Lightbulb size={22} />}
                />
              )
            }
          />

          <textarea
            id="decision-lessons-learned"
            aria-label="Decision lessons learned"
            value={lessonsLearned}
            disabled={decisionIsReadOnly || isArchivedDecision}
            onChange={(e) => {
              clearSaveErrorForSection(learningDecisionActivity)
              setLearningSaved(false)
              setLessonsLearned(e.target.value)
            }}
            rows={5}
            className={`mt-4 ${textareaClass.replace("mt-2 ", "")}`}
          />

          <div className="mt-2 flex flex-wrap gap-2">
            {learningCapturePrompts.map(prompt => (
              <button
                key={prompt.label}
                type="button"
                disabled={decisionIsReadOnly || isArchivedDecision}
                onClick={() => handleAddLearningPrompt(prompt.text)}
                className="rounded-full border border-[var(--decisionate-brand-accent-ring)] bg-[var(--decisionate-brand-accent-soft)] px-3 py-1 text-xs font-medium text-[var(--decisionate-brand-accent-text)] transition hover:opacity-80 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-400"
              >
                {prompt.label}
              </button>
            ))}
          </div>

          <SectionSaveActions
            section={learningDecisionActivity}
            savingSection={savingSection}
            saveError={saveError}
            isArchived={isArchivedDecision}
            disabled={decisionIsReadOnly || learningSaveDisabled}
            label="Save Learning"
            onClick={handleSaveLearning}
          />
        </DashboardCard>
      </div>

      {/* =========================
          Decision Timeline Feed For Recorded Activity Events
      ========================= */}

      <DashboardCard>
        <CardHeader
          title="Decision Timeline"
          description="Key events in the lifecycle of this decision."
          icon={
            <IconBadge
              className="bg-gray-100 text-gray-600"
              icon={<Calendar size={22} />}
            />
          }
        />

        {/* =========================
            Decision Timeline Activity Load Error Message
        ========================= */}

        {activityLoadError && (
          <div className="mt-4 flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-medium text-red-700">
              {activityLoadError}
            </p>

            <button
              type="button"
              onClick={handleRetryActivities}
              disabled={activitiesLoading}
              className="w-fit rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:text-red-300"
            >
              {activitiesLoading
                ? "Retrying..."
                : "Retry Timeline"}
            </button>
          </div>
        )}

        <div className="mt-4 space-y-4 border-l-2 border-gray-200 pl-4 md:max-h-96 md:overflow-y-auto md:pr-2">
          {activitiesLoading && activities.length === 0 ? (
            <p className="text-sm text-gray-500">
              Loading timeline...
            </p>
          ) : activities.length > 0 ? (
            <>
              {activities.map((activity) => (
                <TimelineEvent
                  key={activity.id}
                  color={getDecisionActivityDotClass(
                    activity.activity_type
                  )}
                  title={activity.message}
                  date={formatActivityDateTime(
                    activity.created_at
                  )}
                  titleClassName={getDecisionActivityTitleClass(
                    activity.activity_type
                  )}
                />
              ))}

              {hasMoreActivities && (
                <button
                  type="button"
                  onClick={handleLoadMoreActivities}
                  disabled={activitiesLoading}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition hover:border-[var(--decisionate-brand-primary-ring)] hover:text-[var(--decisionate-brand-primary-text)] disabled:cursor-not-allowed disabled:text-gray-300"
                >
                  {activitiesLoading
                    ? "Loading timeline..."
                    : "Load more timeline"}
                </button>
              )}
            </>
          ) : (
            <FallbackTimeline
              decision={decision}
            />
          )}
        </div>
      </DashboardCard>
    </div>
  )
}

/* =========================
   Decision Detail Reusable Card Header Badge And Field Components
========================= */

function DashboardCard({
  children,
  className = "",
}: {
  children: ReactNode
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

function CardHeader({
  title,
  description,
  icon,
}: {
  title: string
  description: string
  icon: ReactNode
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

      {icon}
    </div>
  )
}

function IconBadge({
  icon,
  className,
  large = false,
}: {
  icon: ReactNode
  className: string
  large?: boolean
}) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full ${
        large
          ? "h-14 w-14"
          : "h-12 w-12"
      } ${className}`}
    >
      {icon}
    </div>
  )
}

function Badge({
  children,
  className,
}: {
  children: ReactNode
  className: string
}) {
  return (
    <span
      className={`inline-block max-w-full break-words rounded-full border px-3 py-1 text-sm font-medium ${className}`}
    >
      {children}
    </span>
  )
}

function SavedBadge({
  label = "Saved",
}: {
  label?: string
}) {
  return (
    <span className="rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
      ✓ {label}
    </span>
  )
}

function Field({
  label,
  children,
  className = "",
  required = false,
}: {
  label: string
  children: ReactNode
  className?: string
  required?: boolean
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="text-sm font-medium text-gray-600">
        {label}
        {required && (
          <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
            Required
          </span>
        )}
      </p>

      {children}
    </div>
  )
}

function SaveButtonRow({
  children,
}: {
  children: ReactNode
}) {
  return (
    <div className="mt-auto pt-4">
      {children}
    </div>
  )
}

/* =========================
   Decision Detail Save Feedback Helpers For Section Level Errors
========================= */

function getSaveErrorMessage(
  error: unknown,
  fallbackMessage: string
) {
  return error instanceof Error
    ? error.message
    : fallbackMessage
}

/* =========================
   Decision Detail Section Save State And Action Row Helpers
========================= */

function getSectionSaveDisabled({
  isArchived,
  savingSection,
  section,
  changed,
  invalid = false,
}: {
  isArchived: boolean
  savingSection: SaveSection | null
  section: SaveSection
  changed: boolean
  invalid?: boolean
}) {
  return (
    isArchived ||
    savingSection === section ||
    !changed ||
    invalid
  )
}

function SectionSaveActions({
  section,
  savingSection,
  saveError,
  isArchived,
  disabled,
  label,
  onClick,
  children,
}: {
  section: SaveSection
  savingSection: SaveSection | null
  saveError: SaveError | null
  isArchived: boolean
  disabled: boolean
  label: string
  onClick: () => void
  children?: ReactNode
}) {
  return (
    <SaveButtonRow>
      <SaveActionButton
        onClick={onClick}
        isArchived={isArchived}
        isSaving={savingSection === section}
        disabled={disabled}
        label={label}
      />

      {children}

      <SaveFeedback
        section={section}
        savingSection={savingSection}
        saveError={saveError}
      />
    </SaveButtonRow>
  )
}

function SaveActionButton({
  onClick,
  disabled,
  isArchived,
  isSaving,
  label,
}: {
  onClick: () => void
  disabled: boolean
  isArchived: boolean
  isSaving: boolean
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={getSaveButtonClass(disabled)}
    >
      {isArchived
        ? "Restore to edit"
        : isSaving
          ? "Saving..."
          : label}
    </button>
  )
}

function isDecisionUnavailableError(
  error: unknown
) {
  if (error instanceof ApiError) {
    return error.status === 404
  }

  return error instanceof Error &&
    error.message === "Decision not found"
}

function SaveFeedback({
  section,
  savingSection,
  saveError,
}: {
  section: SaveSection
  savingSection: SaveSection | null
  saveError: SaveError | null
}) {
  if (savingSection === section) {
    return (
      <p className="mt-2 text-sm text-gray-500">
        Saving changes...
      </p>
    )
  }

  if (saveError?.section === section) {
    return (
      <p className="mt-2 text-sm font-medium text-red-600">
        {saveError.message}
      </p>
    )
  }

  return null
}

/* =========================
   Decision Health Score Badge And Requirement Item Components
========================= */

function HealthItem({
  title,
  value,
  complete,
  muted = false,
  optional = false,
}: {
  title: string
  value: string
  complete: boolean
  muted?: boolean
  optional?: boolean
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${getHealthItemClass(
        complete,
        muted,
        optional
      )}`}
    >
      <p className="text-sm text-gray-500">
        {title}
      </p>

      <p className="mt-1 text-sm font-semibold">
        {value}
      </p>
    </div>
  )
}

function getHealthItemClass(
  complete: boolean,
  muted: boolean,
  optional: boolean
) {
  if (muted || optional) {
    if (optional && complete && !muted) {
      return "border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)]"
    }

    return "border-gray-200 bg-gray-50"
  }

  return complete
    ? "border-green-200 bg-green-50"
    : "border-amber-200 bg-amber-50"
}

function HealthLevelBadge({
  statusLabel,
}: {
  statusLabel: DecisionHealthLabel
}) {
  return (
    <span
      className={`rounded-full border px-2 py-1 text-xs font-medium ${getHealthBadgeClass(
        statusLabel
      )}`}
    >
      {statusLabel}
    </span>
  )
}

function getHealthIconClass(
  statusLabel: DecisionHealthLabel
) {
  if (statusLabel === archivedDecisionHealthLabel) {
    return "bg-gray-100 text-gray-600"
  }

  if (statusLabel === healthyDecisionHealthLabel) {
    return "bg-green-50 text-green-600"
  }

  if (statusLabel === inProgressDecisionHealthLabel) {
    return "bg-[var(--decisionate-brand-primary-soft)] text-[var(--decisionate-brand-primary-text)]"
  }

  if (statusLabel === cancelledDecisionHealthLabel) {
    return "bg-red-50 text-red-600"
  }

  if (statusLabel === needsReviewDecisionHealthLabel) {
    return "bg-amber-50 text-amber-600"
  }

  return "bg-gray-50 text-gray-600"
}

function getHealthBadgeClass(
  statusLabel: DecisionHealthLabel
) {
  if (statusLabel === archivedDecisionHealthLabel) {
    return "border-gray-200 bg-gray-50 text-gray-600"
  }

  if (statusLabel === healthyDecisionHealthLabel) {
    return "border-green-200 bg-green-50 text-green-700"
  }

  if (statusLabel === needsReviewDecisionHealthLabel) {
    return "border-amber-200 bg-amber-50 text-amber-700"
  }

  if (statusLabel === inProgressDecisionHealthLabel) {
    return "border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] text-[var(--decisionate-brand-primary-text)]"
  }

  if (statusLabel === cancelledDecisionHealthLabel) {
    return "border-red-200 bg-red-50 text-red-700"
  }

  return "border-gray-200 bg-gray-50 text-gray-700"
}

function getHealthProgressClass(
  statusLabel: DecisionHealthLabel,
  score: number
) {
  if (statusLabel === archivedDecisionHealthLabel) {
    return "bg-gray-400"
  }

  return score === 100
    ? "bg-green-500"
    : "bg-amber-500"
}

function getHealthScoreDisplay(
  statusLabel: DecisionHealthLabel,
  score: number
) {
  return statusLabel === archivedDecisionHealthLabel
    ? "Archived Record"
    : `${score}% Complete`
}

function getHealthRequirementDisplay(
  statusLabel: DecisionHealthLabel,
  completedItems: number,
  totalItems: number
) {
  return statusLabel === archivedDecisionHealthLabel
    ? "Historical decision record"
    : `${completedItems} of ${totalItems} requirements completed`
}

/* =========================
   Decision Timeline Event Row Component
========================= */

function TimelineEvent({
  color,
  title,
  date,
  titleClassName = "",
}: {
  color: string
  title: string
  date: string
  titleClassName?: string
}) {
  return (
    <div className="flex items-start gap-3">
      <div
        className={`mt-1 h-3 w-3 rounded-full ${color}`}
      />

      <div>
        <p className={`font-medium ${titleClassName}`}>
          {title}
        </p>

        <p className="text-sm text-gray-500">
          {date}
        </p>
      </div>
    </div>
  )
}

/* =========================
   Decision Timeline Fallback And Activity Styling Helpers
========================= */

function FallbackTimeline({
  decision,
}: {
  decision: DecisionRecord
}) {
  return (
    <>
      <TimelineEvent
        color="bg-[var(--decisionate-brand-primary)]"
        title="Decision created"
        date={formatActivityDateTime(
          decision.created_at
        )}
      />

      {decision.review_date && (
        <TimelineEvent
          color="bg-amber-500"
          title="Review scheduled"
          date={formatActivityDateTime(
            decision.review_date
          )}
          titleClassName="text-amber-700"
        />
      )}

      {hasRecordedOutcome(decision) && (
        <TimelineEvent
          color="bg-green-500"
          title="Outcome recorded"
          date="—"
          titleClassName="text-green-700"
        />
      )}

      {decision.lessons_learned && (
      <TimelineEvent
          color="bg-[var(--decisionate-brand-accent)]"
          title="Learning captured"
          date="—"
          titleClassName="text-[var(--decisionate-brand-accent-text)]"
        />
      )}
    </>
  )
}

function getSaveButtonClass(disabled: boolean) {
  return `w-full rounded-lg border px-4 py-2 font-medium transition sm:w-36 ${
    disabled
      ? "cursor-not-allowed opacity-50"
      : "cursor-pointer hover:bg-gray-50"
  }`
}

function getArchiveButtonClass(disabled: boolean) {
  return `w-full rounded-lg border px-4 py-2 font-medium transition sm:w-40 ${
    disabled
      ? "cursor-not-allowed border-gray-200 text-gray-400"
      : "border-gray-300 text-gray-700 hover:bg-gray-50"
  }`
}

function formatDecisionDatasetLabel(
  dataset: DatasetSummary | null,
  datasetId: number
) {
  if (!dataset) {
    return `#${datasetId}`
  }

  const sourceDetails =
    getDatasetSourceDetails(
      dataset.source_type,
      dataset.source_config,
      dataset.source_label
    )

  return `${dataset.file_name} (${sourceDetails.label})`
}

/* =========================
   Decision Timeline Date Formatting Helper For Activity Audit Readability
========================= */

function formatActivityDateTime(
  value: string
) {
  const date = getDecisionDateValue(value)

  if (!date) {
    return "Unknown time"
  }

  return date.toLocaleString(
    undefined,
    {
      dateStyle: "medium",
      timeStyle: "short",
    }
  )
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
  return (
    getDecisionDateValue(value)
      ?.toLocaleDateString() ??
    "Unknown date"
  )
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

/* =========================
   Decision Detail Route Id Parser For Invalid URL Protection
========================= */

function getDecisionRouteId(
  routeId: string | string[] | undefined
) {
  const rawRouteId =
    Array.isArray(routeId)
      ? routeId[0]
      : routeId

  if (!rawRouteId) {
    return null
  }

  const decisionId =
    Number(rawRouteId)

  return Number.isInteger(decisionId) &&
    decisionId > 0
    ? decisionId
    : null
}

/* =========================
   Decision Review Urgency Helper For Date Only Comparison
========================= */

function getReviewUrgency(
  reviewDateValue: Date | null
) {
  if (!reviewDateValue) {
    return "No Review Scheduled"
  }

  const today =
    new Date()

  today.setHours(
    0,
    0,
    0,
    0
  )

  const reviewDay =
    new Date(reviewDateValue)

  reviewDay.setHours(
    0,
    0,
    0,
    0
  )

  return reviewDay < today
    ? "Review Overdue"
    : "Review Scheduled"
}

function getReviewUrgencyClass(reviewUrgency: string) {
  if (reviewUrgency === "Review Overdue") {
    return "border-red-200 bg-red-50 text-red-700"
  }

  if (reviewUrgency === "Review Scheduled") {
    return "border-green-200 bg-green-50 text-green-700"
  }

  return "border-amber-200 bg-amber-50 text-amber-700"
}

function hasOverdueReview(decision: DecisionRecord) {
  return getReviewUrgency(
    getDecisionDateValue(decision.review_date)
  ) === "Review Overdue"
}

function getNextAction(decision: DecisionRecord) {
  if (decision.status === archivedDecisionStatus) {
    return "This decision is archived for historical reference."
  }

  if (hasOverdueReview(decision)) {
    return "Review this decision and schedule the next review."
  }

  if (!hasPlannedOutcome(decision)) {
    return "Define the expected outcome before tracking results."
  }

  if (!hasRecordedOutcome(decision)) {
    return "Record the outcome of this decision."
  }

  if (!hasCapturedLearning(decision)) {
    return "Capture lessons learned from the outcome."
  }

  if (!decision.review_date) {
    return "Schedule a review date."
  }

  if (!hasAddedNotes(decision)) {
    return "Add notes to complete the decision record."
  }

  if (!decision.confidence_score) {
    return "Set confidence to clarify how strong the decision signal is."
  }

  return "This decision is fully documented."
}

function getNextActionTarget(
  decision: DecisionRecord
): DecisionNextActionTarget | null {
  if (decision.status === archivedDecisionStatus) {
    return null
  }

  if (hasOverdueReview(decision)) {
    return {
      elementId: "decision-review-date",
      label: "Reschedule Review",
    }
  }

  if (!hasPlannedOutcome(decision)) {
    return {
      elementId: "decision-expected-outcome",
      label: "Plan Outcome",
    }
  }

  if (!hasRecordedOutcome(decision)) {
    return {
      elementId: "decision-actual-outcome",
      label: "Record Outcome",
    }
  }

  if (!hasCapturedLearning(decision)) {
    return {
      elementId: "decision-lessons-learned",
      label: "Capture Learning",
    }
  }

  if (!decision.review_date) {
    return {
      elementId: "decision-review-date",
      label: "Schedule Review",
    }
  }

  if (!hasAddedNotes(decision)) {
    return {
      elementId: "decision-notes",
      label: "Add Notes",
    }
  }

  if (!decision.confidence_score) {
    return {
      elementId: "decision-confidence-score",
      label: "Set Confidence",
    }
  }

  return null
}

function focusNextActionTarget(
  target: DecisionNextActionTarget
) {
  const element =
    document.getElementById(target.elementId)

  if (!element) {
    return
  }

  element?.scrollIntoView({
    behavior: "smooth",
    block: "center",
  })
  element.focus()
  highlightNextActionTarget(element)
}

function highlightNextActionTarget(
  element: HTMLElement
) {
  const highlightToken =
    String(Date.now())
  const previousTransition =
    element.style.transition
  const previousBoxShadow =
    element.style.boxShadow
  const previousBorderColor =
    element.style.borderColor
  const previousBackgroundColor =
    element.style.backgroundColor

  element.dataset.decisionateNextActionHighlight =
    highlightToken
  element.style.transition = [
    previousTransition,
    "box-shadow 200ms ease",
    "border-color 200ms ease",
    "background-color 200ms ease",
  ].filter(Boolean).join(", ")
  element.style.borderColor =
    "var(--decisionate-brand-primary)"
  element.style.boxShadow =
    "0 0 0 4px var(--decisionate-brand-primary-ring)"
  element.style.backgroundColor =
    "var(--decisionate-brand-primary-soft)"

  window.setTimeout(() => {
    if (
      element.dataset.decisionateNextActionHighlight !==
      highlightToken
    ) {
      return
    }

    element.style.transition =
      previousTransition
    element.style.boxShadow =
      previousBoxShadow
    element.style.borderColor =
      previousBorderColor
    element.style.backgroundColor =
      previousBackgroundColor
    delete element.dataset.decisionateNextActionHighlight
  }, 1800)
}
