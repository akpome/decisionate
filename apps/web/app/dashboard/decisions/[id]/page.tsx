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
  getDecisionActivities,
  getDecision,
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
  hasPendingLearning,
  hasPendingOutcome,
  hasPlannedOutcome,
  hasRecordedOutcome,
} from "@/lib/decision-outcomes"
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
  getDatasetSourceDetails,
} from "@/features/datasets/lib/source-config"
import type {
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
  "mt-2 h-10 w-full rounded-lg border border-gray-200 px-3 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"

const textareaClass =
  "mt-2 w-full rounded-lg border border-gray-200 p-3 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"

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

const archivedHealthStatusLabel = "Archived"
const healthyHealthStatusLabel = "Healthy"
const incompleteHealthStatusLabel = "Incomplete"

type DecisionHealthStatusLabel =
  | typeof archivedHealthStatusLabel
  | typeof healthyHealthStatusLabel
  | typeof incompleteHealthStatusLabel

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

function getShouldFocusNextActionFromUrl() {
  if (typeof window === "undefined") {
    return false
  }

  return new URLSearchParams(window.location.search)
    .get("focus") === "next-action"
}

export default function DecisionPage() {
  const params = useParams()
  const { user } = useUser()
  const {
    activeWorkspaceId,
    workspaceVersion,
  } = useActiveWorkspace(user?.id)

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

  const [lessonsLearned, setLessonsLearned] = useState("")
  const [originalLessonsLearned, setOriginalLessonsLearned] = useState("")
  const [learningSaved, setLearningSaved] = useState(false)
  const [showActionQueueBackLink] =
    useState(() => getShouldFocusNextActionFromUrl())
  const lastAutoFocusedDecisionId = useRef<number | null>(null)

  useEffect(() => {
    if (!user?.id) return
    const userId = user.id

    async function load() {
      try {
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

        setDecision(data)

        await loadActivities(
          data.id,
          userId,
          activeWorkspaceId
        )

        try {
          const datasetData =
            await getDataset(
              data.dataset_id,
              userId,
              activeWorkspaceId
            )

          setDataset(datasetData)
        } catch (datasetError) {
          console.error(datasetError)
          setDataset(null)
        }

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
      } catch (error) {
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
  }, [
    loadRetryKey,
    params.id,
    activeWorkspaceId,
    user?.id,
    workspaceVersion,
  ])

  async function loadActivities(
    decisionId: number,
    userId: string,
    workspaceId: string
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

      setActivities(data)
      setHasMoreActivities(
        data.length === timelineActivityPageSize
      )
    } catch (error) {
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
      setActivitiesLoading(false)
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

    try {
      const data =
        await getDecisionActivities(
          decision.id,
          user.id,
          activeWorkspaceId,
          timelineActivityPageSize,
          activities.length
        )

      setActivities([
        ...activities,
        ...data,
      ])

      setHasMoreActivities(
        data.length === timelineActivityPageSize
      )
    } catch (error) {
      console.error(error)
      setActivityLoadError(
        getSaveErrorMessage(
          error,
          "More timeline events could not be loaded."
        )
      )
    } finally {
      setActivitiesLoading(false)
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
    description !== originalDescription

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
      showSaved(setDetailsSaved)
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
      showSaved(setOverviewSaved)
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
      showSaved(setNoteSaved)
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

    setSavingSection(outcomeDecisionActivity)
    setSaveError(null)

    try {
      const outcomePayload: DecisionOutcomePayload = {}

      if (expectedOutcome !== originalExpectedOutcome) {
        outcomePayload.expected_outcome = expectedOutcome
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
      await loadActivities(
        data.id,
        user.id,
        activeWorkspaceId
      )
      showSaved(setOutcomeSaved)
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
      showSaved(setLearningSaved)
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
    setLessonsLearned(currentValue => {
      const cleanCurrentValue =
        currentValue.trim()

      return cleanCurrentValue
        ? `${cleanCurrentValue}\n\n${prompt}`
        : prompt
    })
  }

  function handleAddNotePrompt(prompt: string) {
    clearSaveErrorForSection(notesDecisionActivity)
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
      showSaved(setArchiveSaved)
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
      showSaved(setRestoreSaved)
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

  useEffect(() => {
    const shouldAutoFocusNextAction =
      getShouldFocusNextActionFromUrl()

    if (
      !decision ||
      !nextActionTarget ||
      !shouldAutoFocusNextAction ||
      lastAutoFocusedDecisionId.current === decision.id
    ) {
      return
    }

    lastAutoFocusedDecisionId.current = decision.id

    const timeoutId = window.setTimeout(() => {
      focusNextActionTarget(nextActionTarget)
    }, 100)

    return () => window.clearTimeout(timeoutId)
  }, [
    decision,
    nextActionTarget,
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

          <p className={`text-sm font-medium ${
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
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition hover:border-blue-200 hover:text-blue-700"
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

        <p className="text-sm text-gray-500">
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
    Boolean(decision.lessons_learned),
    Boolean(decision.review_date),
    Boolean(decision.notes),
  ]

  const completedHealthItems =
    healthItems.filter(Boolean).length

  const healthScore =
    Math.round(
      (completedHealthItems / healthItems.length) * 100
    )

  const decisionAgeDays =
    getDecisionAgeDays(
      decision.created_at
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

  const isHealthy =
    outcomeRecorded &&
    decision.lessons_learned &&
    decision.review_date &&
    decision.notes

  const healthStatusLabel =
    getDecisionHealthStatusLabel(
      decision,
      Boolean(isHealthy)
    )

  const isArchivedDecision =
    decision.status === archivedDecisionStatus

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

  return (
    <div className="space-y-6">
      <Link
        href={backToDecisionsHref}
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft size={16} />
        {backToDecisionsLabel}
      </Link>

      <DashboardCard>
        {/* =========================
            Decision Detail Header With Status Dataset And Review Badges
        ========================= */}

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {decision.title}
            </h1>

            <p className="mt-2 text-gray-600">
              {decision.description || "No description provided."}
            </p>
          </div>

          <IconBadge
            className={
              isArchivedDecision
                ? "bg-gray-100 text-gray-600"
                : "bg-blue-50 text-blue-600"
            }
            icon={<Target size={26} />}
            large
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge className="border-green-200 bg-green-50 text-green-700">
            Outcome: {formatDecisionLabel(decision.outcome_status)}
          </Badge>

          <Badge className="border-blue-200 bg-blue-50 text-blue-700">
            Status: {formatDecisionLabel(decision.status)}
          </Badge>

          <Badge className="border-purple-200 bg-purple-50 text-purple-700">
            Category: {formatDecisionLabel(decision.category)}
          </Badge>

          <Badge className="border-red-200 bg-red-50 text-red-700">
            Priority: {formatDecisionLabel(decision.priority)}
          </Badge>

          {decision.confidence_score && (
            <Badge className="border-indigo-200 bg-indigo-50 text-indigo-700">
              Confidence: {formatDecisionLabel(decision.confidence_score)}
            </Badge>
          )}

          {decision.review_date && (
            <Badge className="border-amber-200 bg-amber-50 text-amber-700">
              Review: {formatDecisionDate(decision.review_date)}
            </Badge>
          )}

          <Badge className="border-gray-200 bg-gray-50 text-gray-700">
            Created: {formatDecisionDate(decision.created_at)}
          </Badge>

          {decision.updated_at && (
            <Badge className="border-gray-200 bg-gray-50 text-gray-700">
              Updated: {formatDecisionDate(decision.updated_at)}
            </Badge>
          )}

          <Badge className="border-blue-200 bg-blue-50 text-blue-700">
            Age: {decisionAgeDays} days
          </Badge>

          <Badge className={getReviewUrgencyClass(reviewUrgency)}>
            {reviewUrgency}
          </Badge>

          <Link
            href={`/dashboard/datasets/${decision.dataset_id}`}
            className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-sm font-medium text-gray-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
          >
            Dataset:{" "}
            {formatDecisionDatasetLabel(
              dataset,
              decision.dataset_id
            )}
          </Link>
        </div>

        <div className={getLifecycleNoticeClass(isArchivedDecision)}>
          <p className="text-sm font-semibold">
            {isArchivedDecision
              ? "Historical decision record"
              : "Active decision record"}
          </p>

          <p className="mt-1 text-sm">
            {isArchivedDecision
              ? "This decision is preserved for reference. Restore it before making changes."
              : "This decision can be updated, reviewed and tracked through outcomes."}
          </p>
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
            onClick={
              isArchivedDecision
                ? handleRestoreDecision
                : handleArchiveDecision
            }
            disabled={
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
                className="bg-blue-50 text-blue-600"
                icon={<ClipboardList size={22} />}
              />
            )
          }
        />

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <Field label="Title">
            <input
              value={title}
              disabled={isArchivedDecision}
              onChange={(e) => {
                clearSaveErrorForSection(detailsDecisionActivity)
                setTitle(e.target.value)
              }}
              className={inputClass}
            />
          </Field>

          <Field label="Description">
            <textarea
              value={description}
              disabled={isArchivedDecision}
              onChange={(e) => {
                clearSaveErrorForSection(detailsDecisionActivity)
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
          disabled={detailsSaveDisabled}
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
          description="Completion status based on outcome, learning, review schedule and notes."
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
              score={healthScore}
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
            muted={healthStatusLabel === archivedHealthStatusLabel}
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
            complete={Boolean(decision.lessons_learned)}
            muted={healthStatusLabel === archivedHealthStatusLabel}
            value={
              decision.lessons_learned
                ? "Captured"
                : "Not Captured"
            }
          />

          <HealthItem
            title="Review"
            complete={Boolean(decision.review_date)}
            muted={healthStatusLabel === archivedHealthStatusLabel}
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
            complete={Boolean(decision.notes)}
            muted={healthStatusLabel === archivedHealthStatusLabel}
            value={
              decision.notes
                ? "Added"
                : "Not Added"
            }
          />

          <HealthItem
            title="Confidence"
            complete={Boolean(decision.confidence_score)}
            muted={healthStatusLabel === archivedHealthStatusLabel}
            optional
            value={formatDecisionLabel(
              decision.confidence_score
            )}
          />
        </div>

        <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-blue-600">
            Next Action
          </p>

          <p className="mt-1 text-sm text-blue-700">
            {nextAction}
          </p>

          {nextActionTarget && (
            <button
              type="button"
              onClick={() => focusNextActionTarget(nextActionTarget)}
              className="mt-3 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-100"
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
                className="mt-2 inline-flex font-medium text-blue-700 hover:text-blue-900"
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
            <Field label="Expected Outcome">
              <textarea
                id="decision-expected-outcome"
                value={expectedOutcome}
                disabled={isArchivedDecision}
                onChange={(e) => {
                  clearSaveErrorForSection(outcomeDecisionActivity)
                  setExpectedOutcome(e.target.value)
                }}
                rows={4}
                className={textareaClass}
              />
            </Field>

            <Field label="Actual Outcome">
              <textarea
                id="decision-actual-outcome"
                value={actualOutcome}
                disabled={isArchivedDecision}
                onChange={(e) => {
                  clearSaveErrorForSection(outcomeDecisionActivity)
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
              value={outcomeStatus}
              disabled={isArchivedDecision}
              onChange={(e) => {
                clearSaveErrorForSection(outcomeDecisionActivity)
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
                  disabled={isArchivedDecision}
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
            disabled={outcomeSaveDisabled}
            label="Save Outcome"
            onClick={handleSaveOutcome}
          />
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
                  className="bg-blue-50 text-blue-600"
                  icon={<ClipboardList size={22} />}
                />
              )
            }
          />

          <div className="mt-4 grid gap-x-6 gap-y-4 md:grid-cols-2">
            <Field label="Status">
              <select
                value={status}
                disabled={isArchivedDecision}
                onChange={(e) => {
                  clearSaveErrorForSection(overviewDecisionActivity)
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
                value={priority}
                disabled={isArchivedDecision}
                onChange={(e) => {
                  clearSaveErrorForSection(overviewDecisionActivity)
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
                value={category}
                disabled={isArchivedDecision}
                onChange={(e) => {
                  clearSaveErrorForSection(overviewDecisionActivity)
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
                value={confidenceScore}
                disabled={isArchivedDecision}
                onChange={(e) => {
                  clearSaveErrorForSection(overviewDecisionActivity)
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
                type="date"
                value={reviewDate}
                disabled={isArchivedDecision}
                onChange={(e) => {
                  clearSaveErrorForSection(overviewDecisionActivity)
                  setReviewDate(e.target.value)
                }}
                className={inputClass}
              />

              <div className="mt-2 flex flex-wrap gap-2">
                {reviewDateQuickActions.map(action => (
                  <button
                    key={action.days}
                    type="button"
                    disabled={isArchivedDecision}
                    onClick={() => handleSetReviewDateOffset(action.days)}
                    className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-400"
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
            disabled={overviewSaveDisabled}
            label="Save Overview"
            onClick={handleSaveOverview}
          />
        </DashboardCard>
      </div>

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
            value={notes}
            disabled={isArchivedDecision}
            onChange={(e) => {
              clearSaveErrorForSection(notesDecisionActivity)
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
                disabled={isArchivedDecision}
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
            disabled={noteSaveDisabled}
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
                  className="bg-purple-50 text-purple-600"
                  icon={<Lightbulb size={22} />}
                />
              )
            }
          />

          <textarea
            id="decision-lessons-learned"
            value={lessonsLearned}
            disabled={isArchivedDecision}
            onChange={(e) => {
              clearSaveErrorForSection(learningDecisionActivity)
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
                disabled={isArchivedDecision}
                onClick={() => handleAddLearningPrompt(prompt.text)}
                className="rounded-full border border-purple-100 bg-purple-50 px-3 py-1 text-xs font-medium text-purple-700 transition hover:bg-purple-100 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-400"
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
            disabled={learningSaveDisabled}
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

        <div className="mt-4 max-h-96 space-y-4 overflow-y-auto border-l-2 border-gray-200 pl-4 pr-2">
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
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition hover:border-blue-200 hover:text-blue-700 disabled:cursor-not-allowed disabled:text-gray-300"
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
      className={`rounded-2xl border border-gray-200 bg-white p-6 shadow-sm ${className}`}
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
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">
          {title}
        </h2>

        <p className="mt-1 text-sm text-gray-600">
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
      className={`rounded-full border px-3 py-1 text-sm font-medium ${className}`}
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
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <p className="text-sm font-medium text-gray-600">
        {label}
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
      return "border-indigo-200 bg-indigo-50"
    }

    return "border-gray-200 bg-gray-50"
  }

  return complete
    ? "border-green-200 bg-green-50"
    : "border-amber-200 bg-amber-50"
}

function HealthLevelBadge({
  score,
  statusLabel,
}: {
  score: number
  statusLabel: DecisionHealthStatusLabel
}) {
  if (statusLabel === archivedHealthStatusLabel) {
    return (
      <span className="rounded-full bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600">
        Archived
      </span>
    )
  }

  return (
    <span
      className={`rounded-full px-2 py-1 text-xs font-medium ${
        score === 100
          ? "bg-green-50 text-green-700"
          : score >= 75
            ? "bg-blue-50 text-blue-700"
            : score >= 50
              ? "bg-amber-50 text-amber-700"
              : "bg-red-50 text-red-700"
      }`}
    >
      {score === 100
        ? "Complete"
        : score >= 75
          ? "Near Complete"
          : score >= 50
            ? "In Progress"
            : "Needs Attention"}
    </span>
  )
}

function getDecisionHealthStatusLabel(
  decision: DecisionRecord,
  isHealthy: boolean
): DecisionHealthStatusLabel {
  if (decision.status === archivedDecisionStatus) {
    return archivedHealthStatusLabel
  }

  return isHealthy
    ? healthyHealthStatusLabel
    : incompleteHealthStatusLabel
}

function getHealthIconClass(
  statusLabel: DecisionHealthStatusLabel
) {
  if (statusLabel === archivedHealthStatusLabel) {
    return "bg-gray-100 text-gray-600"
  }

  if (statusLabel === healthyHealthStatusLabel) {
    return "bg-green-50 text-green-600"
  }

  return "bg-amber-50 text-amber-600"
}

function getHealthProgressClass(
  statusLabel: DecisionHealthStatusLabel,
  score: number
) {
  if (statusLabel === archivedHealthStatusLabel) {
    return "bg-gray-400"
  }

  return score === 100
    ? "bg-green-500"
    : "bg-amber-500"
}

function getHealthScoreDisplay(
  statusLabel: DecisionHealthStatusLabel,
  score: number
) {
  return statusLabel === archivedHealthStatusLabel
    ? "Archived Record"
    : `${score}% Complete`
}

function getHealthRequirementDisplay(
  statusLabel: DecisionHealthStatusLabel,
  completedItems: number,
  totalItems: number
) {
  return statusLabel === archivedHealthStatusLabel
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
        color="bg-blue-500"
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
          color="bg-purple-500"
          title="Learning captured"
          date="—"
          titleClassName="text-purple-700"
        />
      )}
    </>
  )
}

function getSaveButtonClass(disabled: boolean) {
  return `w-36 rounded-lg border px-4 py-2 font-medium transition ${
    disabled
      ? "cursor-not-allowed opacity-50"
      : "cursor-pointer hover:bg-gray-50"
  }`
}

function getArchiveButtonClass(disabled: boolean) {
  return `w-40 rounded-lg border px-4 py-2 font-medium transition ${
    disabled
      ? "cursor-not-allowed border-gray-200 text-gray-400"
      : "border-gray-300 text-gray-700 hover:bg-gray-50"
  }`
}

function getLifecycleNoticeClass(
  archived: boolean
) {
  return `mt-4 rounded-xl border px-4 py-3 ${
    archived
      ? "border-gray-200 bg-gray-50 text-gray-600"
      : "border-blue-100 bg-blue-50 text-blue-700"
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

function getDecisionAgeDays(
  createdAt?: string | null
) {
  const createdDate =
    getDecisionDateValue(createdAt)

  if (!createdDate) {
    return 0
  }

  return Math.max(
    0,
    Math.floor(
      (
        new Date().getTime() -
        createdDate.getTime()
      ) /
        (1000 * 60 * 60 * 24)
    )
  )
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

  if (!decision.lessons_learned) {
    return "Capture lessons learned from the outcome."
  }

  if (!decision.review_date) {
    return "Schedule a review date."
  }

  if (!decision.notes) {
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

  if (!decision.lessons_learned) {
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

  if (!decision.notes) {
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

  element?.scrollIntoView({
    behavior: "smooth",
    block: "center",
  })
  element?.focus()
}

function showSaved(
  setter: (value: boolean) => void
) {
  setter(true)

  setTimeout(() => {
    setter(false)
  }, 3000)
}
