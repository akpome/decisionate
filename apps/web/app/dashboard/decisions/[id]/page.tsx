"use client"

import {
  useEffect,
  useState,
  type ReactNode,
} from "react"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useUser } from "@clerk/nextjs"

import {
  ArrowLeft,
  Calendar,
  ClipboardList,
  FileText,
  Lightbulb,
  ShieldCheck,
  Target,
} from "lucide-react"

import {
  getDecision,
  updateDecision,
  updateDecisionNotes,
  updateDecisionOutcome,
  updateDecisionLearning,
  updateDecisionReviewDate,
  updateDecisionPriority,
  updateDecisionCategory,
} from "@/lib/api"

const inputClass =
  "mt-2 h-10 w-full rounded-lg border border-gray-200 px-3 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"

const textareaClass =
  "mt-2 w-full rounded-lg border border-gray-200 p-3 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"

export default function DecisionPage() {
  const params = useParams()
  const { user } = useUser()

  const [decision, setDecision] = useState<any>(null)

  const [status, setStatus] = useState("")
  const [originalStatus, setOriginalStatus] = useState("")

  const [priority, setPriority] = useState("")
  const [originalPriority, setOriginalPriority] = useState("")

  const [category, setCategory] = useState("")
  const [originalCategory, setOriginalCategory] = useState("")

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

  const [outcomeStatus, setOutcomeStatus] = useState("")
  const [originalOutcomeStatus, setOriginalOutcomeStatus] = useState("")

  const [outcomeSaved, setOutcomeSaved] = useState(false)

  const [lessonsLearned, setLessonsLearned] = useState("")
  const [originalLessonsLearned, setOriginalLessonsLearned] = useState("")
  const [learningSaved, setLearningSaved] = useState(false)

  useEffect(() => {
    if (!user?.id) return
    const userId = user.id

    async function load() {
      try {
        const data = await getDecision(
          Number(params.id),
          userId
        )

        setDecision(data)

        setStatus(data.status ?? "planned")
        setOriginalStatus(data.status ?? "planned")

        setPriority(data.priority ?? "medium")
        setOriginalPriority(data.priority ?? "medium")

        setCategory(data.category ?? "general")
        setOriginalCategory(data.category ?? "general")

        const reviewDateValue =
          data.review_date
            ? data.review_date.split("T")[0]
            : ""

        setReviewDate(reviewDateValue)
        setOriginalReviewDate(reviewDateValue)

        setNotes(data.notes ?? "")
        setOriginalNotes(data.notes ?? "")

        setExpectedOutcome(data.expected_outcome ?? "")
        setOriginalExpectedOutcome(data.expected_outcome ?? "")

        setActualOutcome(data.actual_outcome ?? "")
        setOriginalActualOutcome(data.actual_outcome ?? "")

        setOutcomeStatus(data.outcome_status ?? "")
        setOriginalOutcomeStatus(data.outcome_status ?? "")

        setLessonsLearned(data.lessons_learned ?? "")
        setOriginalLessonsLearned(data.lessons_learned ?? "")
      } catch (error) {
        console.error(error)
      }
    }

    load()
  }, [params.id, user?.id])

  const statusChanged =
    status !== originalStatus

  const priorityChanged =
    priority !== originalPriority

  const categoryChanged =
    category !== originalCategory

  const reviewDateChanged =
    reviewDate !== originalReviewDate

  const overviewChanged =
    statusChanged ||
    priorityChanged ||
    categoryChanged ||
    reviewDateChanged

  const noteChanged =
    notes !== originalNotes

  const outcomeChanged =
    expectedOutcome !== originalExpectedOutcome ||
    actualOutcome !== originalActualOutcome ||
    outcomeStatus !== originalOutcomeStatus

  const learningChanged =
    lessonsLearned !== originalLessonsLearned

  async function handleSaveOverview() {
    if (!user?.id || !decision) return

    try {
      let updatedDecision = decision

      if (statusChanged) {
        updatedDecision = await updateDecision(
          decision.id,
          status,
          user.id
        )

        setOriginalStatus(status)
      }

      if (priorityChanged) {
        updatedDecision = await updateDecisionPriority(
          decision.id,
          priority,
          user.id
        )

        setOriginalPriority(priority)
      }

      if (categoryChanged) {
        updatedDecision = await updateDecisionCategory(
          decision.id,
          category,
          user.id
        )

        setOriginalCategory(category)
      }

      if (reviewDateChanged) {
        updatedDecision = await updateDecisionReviewDate(
          decision.id,
          reviewDate
            ? `${reviewDate}T00:00:00`
            : "",
          user.id
        )

        setOriginalReviewDate(reviewDate)
      }

      setDecision(updatedDecision)
      showSaved(setOverviewSaved)
    } catch (error) {
      console.error(error)
    }
  }

  async function handleSaveNote() {
    if (!user?.id || !decision) return

    try {
      const data = await updateDecisionNotes(
        decision.id,
        notes,
        user.id
      )

      setDecision(data)
      setOriginalNotes(notes)
      showSaved(setNoteSaved)
    } catch (error) {
      console.error(error)
    }
  }

  async function handleSaveOutcome() {
    if (!user?.id || !decision) return

    try {
      const data = await updateDecisionOutcome(
        decision.id,
        {
          expected_outcome: expectedOutcome,
          actual_outcome: actualOutcome,
          outcome_status: outcomeStatus,
        },
        user.id
      )

      setDecision(data)
      setOriginalExpectedOutcome(expectedOutcome)
      setOriginalActualOutcome(actualOutcome)
      setOriginalOutcomeStatus(outcomeStatus)
      showSaved(setOutcomeSaved)
    } catch (error) {
      console.error(error)
    }
  }

  async function handleSaveLearning() {
    if (!user?.id || !decision) return

    try {
      const data = await updateDecisionLearning(
        decision.id,
        lessonsLearned,
        user.id
      )

      setDecision(data)
      setOriginalLessonsLearned(lessonsLearned)
      showSaved(setLearningSaved)
    } catch (error) {
      console.error(error)
    }
  }

  if (!decision) {
    return (
      <DashboardCard>
        <p className="text-sm text-gray-500">
          Loading decision...
        </p>
      </DashboardCard>
    )
  }

  const healthItems = [
    Boolean(decision.outcome_status),
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
    Math.floor(
      (
        new Date().getTime() -
        new Date(decision.created_at).getTime()
      ) /
      (1000 * 60 * 60 * 24)
    )

  const reviewDateValue =
    decision.review_date
      ? new Date(decision.review_date)
      : null

  const reviewUrgency =
    !reviewDateValue
      ? "No Review Scheduled"
      : reviewDateValue < new Date()
        ? "Review Overdue"
        : "Review Scheduled"

  const isHealthy =
    decision.outcome_status &&
    decision.lessons_learned &&
    decision.review_date &&
    decision.notes

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/decisions"
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft size={16} />
        Back to Decisions
      </Link>

      <DashboardCard>
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
            className="bg-blue-50 text-blue-600"
            icon={<Target size={26} />}
            large
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge className="border-green-200 bg-green-50 text-green-700">
            Outcome: {formatLabel(decision.outcome_status)}
          </Badge>

          <Badge className="border-blue-200 bg-blue-50 text-blue-700">
            Status: {formatLabel(decision.status)}
          </Badge>

          <Badge className="border-purple-200 bg-purple-50 text-purple-700">
            Category: {formatLabel(decision.category)}
          </Badge>

          <Badge className="border-red-200 bg-red-50 text-red-700">
            Priority: {formatLabel(decision.priority)}
          </Badge>

          {decision.review_date && (
            <Badge className="border-amber-200 bg-amber-50 text-amber-700">
              Review: {new Date(decision.review_date).toLocaleDateString()}
            </Badge>
          )}

          <Badge className="border-gray-200 bg-gray-50 text-gray-700">
            Created: {new Date(decision.created_at).toLocaleDateString()}
          </Badge>

          {decision.updated_at && (
            <Badge className="border-gray-200 bg-gray-50 text-gray-700">
              Updated: {new Date(decision.updated_at).toLocaleDateString()}
            </Badge>
          )}

          <Badge className="border-blue-200 bg-blue-50 text-blue-700">
            Age: {decisionAgeDays} days
          </Badge>

          <Badge className={getReviewUrgencyClass(reviewUrgency)}>
            {reviewUrgency}
          </Badge>

          {decision.dataset_id && (
            <Badge className="border-gray-200 bg-gray-50 text-gray-700">
              Dataset ID: {decision.dataset_id}
            </Badge>
          )}
        </div>
      </DashboardCard>

      <DashboardCard>
        <CardHeader
          title="Decision Health"
          description="Completion status based on outcome, learning, review schedule and notes."
          icon={
            <StatusBadge
              healthy={Boolean(isHealthy)}
              healthyLabel="Healthy"
              incompleteLabel="Incomplete"
            />
          }
        />

        <div className="mt-4">
          <p className="text-3xl font-bold">
            {healthScore}% Complete
          </p>

          <div className="mt-1 flex items-center gap-2">
            <p className="text-sm text-gray-500">
              {completedHealthItems} of {healthItems.length} requirements completed
            </p>

            <HealthLevelBadge score={healthScore} />
          </div>

          <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full rounded-full ${
                healthScore === 100
                  ? "bg-green-500"
                  : "bg-amber-500"
              }`}
              style={{
                width: `${healthScore}%`,
              }}
            />
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <HealthItem
            title="Outcome"
            complete={Boolean(decision.outcome_status)}
            value={
              decision.outcome_status
                ? "Recorded"
                : "Not Recorded"
            }
          />

          <HealthItem
            title="Learning"
            complete={Boolean(decision.lessons_learned)}
            value={
              decision.lessons_learned
                ? "Captured"
                : "Not Captured"
            }
          />

          <HealthItem
            title="Review"
            complete={Boolean(decision.review_date)}
            value={
              decision.review_date
                ? new Date(decision.review_date).toLocaleDateString()
                : "Not Scheduled"
            }
          />

          <HealthItem
            title="Notes"
            complete={Boolean(decision.notes)}
            value={
              decision.notes
                ? "Added"
                : "Not Added"
            }
          />
        </div>

        <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-blue-600">
            Next Action
          </p>

          <p className="mt-1 text-sm text-blue-700">
            {getNextAction(decision)}
          </p>
        </div>
      </DashboardCard>

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
                value={expectedOutcome}
                onChange={(e) => setExpectedOutcome(e.target.value)}
                rows={4}
                className={textareaClass}
              />
            </Field>

            <Field label="Actual Outcome">
              <textarea
                value={actualOutcome}
                onChange={(e) => setActualOutcome(e.target.value)}
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
              value={outcomeStatus}
              onChange={(e) => setOutcomeStatus(e.target.value)}
              className={inputClass}
            >
              <option value="">
                Select status
              </option>
              <option value="successful">
                Successful
              </option>
              <option value="partially_successful">
                Partially Successful
              </option>
              <option value="unsuccessful">
                Unsuccessful
              </option>
            </select>
          </Field>

          <SaveButtonRow>
            <button
              onClick={handleSaveOutcome}
              disabled={!outcomeChanged}
              className={getSaveButtonClass(!outcomeChanged)}
            >
              Save Outcome
            </button>
          </SaveButtonRow>
        </DashboardCard>

        <DashboardCard className="flex h-full flex-col">
          <CardHeader
            title="Decision Overview"
            description="Manage decision status, priority, category and review schedule."
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
                onChange={(e) => setStatus(e.target.value)}
                className={inputClass}
              >
                <option value="planned">Planned</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </Field>

            <Field label="Priority">
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className={inputClass}
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </Field>

            <Field label="Category">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={inputClass}
              >
                <option value="general">General</option>
                <option value="marketing">Marketing</option>
                <option value="sales">Sales</option>
                <option value="operations">Operations</option>
                <option value="finance">Finance</option>
                <option value="hiring">Hiring</option>
                <option value="product">Product</option>
              </select>
            </Field>

            <Field label="Review Date">
              <input
                type="date"
                value={reviewDate}
                onChange={(e) => setReviewDate(e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>

          <SaveButtonRow>
            <button
              onClick={handleSaveOverview}
              disabled={!overviewChanged}
              className={getSaveButtonClass(!overviewChanged)}
            >
              Save Overview
            </button>
          </SaveButtonRow>
        </DashboardCard>
      </div>

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
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={5}
            className={`mt-4 ${textareaClass.replace("mt-2 ", "")}`}
          />

          <SaveButtonRow>
            <button
              onClick={handleSaveNote}
              disabled={!noteChanged}
              className={getSaveButtonClass(!noteChanged)}
            >
              Save Note
            </button>
          </SaveButtonRow>
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
            value={lessonsLearned}
            onChange={(e) => setLessonsLearned(e.target.value)}
            rows={5}
            className={`mt-4 ${textareaClass.replace("mt-2 ", "")}`}
          />

          <SaveButtonRow>
            <button
              onClick={handleSaveLearning}
              disabled={!learningChanged}
              className={getSaveButtonClass(!learningChanged)}
            >
              Save Learning
            </button>
          </SaveButtonRow>
        </DashboardCard>
      </div>

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

        <div className="mt-4 space-y-4 border-l-2 border-gray-200 pl-4">
          <TimelineEvent
            color="bg-blue-500"
            title="Decision created"
            date={new Date(decision.created_at).toLocaleDateString()}
          />

          {decision.review_date && (
            <TimelineEvent
              color="bg-amber-500"
              title="Review scheduled"
              date={new Date(decision.review_date).toLocaleDateString()}
              titleClassName="text-amber-700"
            />
          )}

          {decision.outcome_status && (
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
        </div>
      </DashboardCard>
    </div>
  )
}

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

function SavedBadge() {
  return (
    <span className="rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
      ✓ Saved
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

function HealthItem({
  title,
  value,
  complete,
}: {
  title: string
  value: string
  complete: boolean
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        complete
          ? "border-green-200 bg-green-50"
          : "border-amber-200 bg-amber-50"
      }`}
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

function HealthLevelBadge({
  score,
}: {
  score: number
}) {
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

function StatusBadge({
  healthy,
  healthyLabel,
  incompleteLabel,
}: {
  healthy: boolean
  healthyLabel: string
  incompleteLabel: string
}) {
  return (
    <span
      className={`rounded-full border px-4 py-2 text-sm font-medium ${
        healthy
          ? "border-green-200 bg-green-50 text-green-700"
          : "border-amber-200 bg-amber-50 text-amber-700"
      }`}
    >
      {healthy
        ? healthyLabel
        : incompleteLabel}
    </span>
  )
}

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

function getSaveButtonClass(disabled: boolean) {
  return `w-36 rounded-lg border px-4 py-2 font-medium transition ${
    disabled
      ? "cursor-not-allowed opacity-50"
      : "cursor-pointer hover:bg-gray-50"
  }`
}

function formatLabel(value: string | null | undefined) {
  if (!value) return "Pending"

  return value
    .replaceAll("_", " ")
    .replace(
      /\b\w/g,
      (char: string) => char.toUpperCase()
    )
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

function getNextAction(decision: any) {
  if (!decision.outcome_status) {
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

  return "This decision is fully documented."
}

function showSaved(
  setter: (value: boolean) => void
) {
  setter(true)

  setTimeout(() => {
    setter(false)
  }, 3000)
} 