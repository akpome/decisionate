"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useUser } from "@clerk/nextjs"
import {
  AlertCircle,
  Calendar,
  LineChart,
  Plus,
  RefreshCw,
  Target,
} from "lucide-react"

import {
  getDecisions,
  type DecisionRecord,
} from "@/lib/api"
import {
  formatDecisionLabel,
} from "@/lib/decision-options"
import {
  hasPendingLearning,
  hasPendingOutcome,
} from "@/lib/decision-outcomes"
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

type ActionNeededFilter =
  | "all"
  | "overdue"
  | "outcome"
  | "learning"

function getErrorMessage(
  error: unknown,
  fallback: string
) {
  return error instanceof Error &&
    error.message
    ? error.message
    : fallback
}

export default function ActionNeededPage() {
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
  const [decisions, setDecisions] =
    useState<DecisionRecord[]>([])
  const [loading, setLoading] =
    useState(false)
  const [errorMessage, setErrorMessage] =
    useState("")
  const [loadRetryKey, setLoadRetryKey] =
    useState(0)
  const [
    actionNeededFilter,
    setActionNeededFilter,
  ] = useState<ActionNeededFilter>("all")

  const overdueReviewDecisions =
    decisions.filter(hasOverdueReview)
  const outcomePendingDecisions =
    decisions.filter(hasPendingOutcome)
  const learningPendingDecisions =
    decisions.filter(hasPendingLearning)
  const visibleDecisions =
    getVisibleActionNeededDecisions(
      decisions,
      actionNeededFilter
    )
  const actionFilterOptions: {
    key: ActionNeededFilter
    label: string
    count: number
  }[] = [
    {
      key: "all",
      label: "All",
      count: decisions.length,
    },
    {
      key: "overdue",
      label: "Review overdue",
      count: overdueReviewDecisions.length,
    },
    {
      key: "outcome",
      label: "Outcome pending",
      count: outcomePendingDecisions.length,
    },
    {
      key: "learning",
      label: "Learning pending",
      count: learningPendingDecisions.length,
    },
  ]

  useEffect(() => {
    if (!user?.id) return

    let ignoreResult = false

    async function loadActionNeeded(
      userId: string
    ) {
      try {
        setLoading(true)
        setErrorMessage("")
        setDecisions([])

        const data =
          await getDecisions(
            userId,
            activeWorkspaceId,
            {
              attentionState: "required",
              lifecycle: "active",
              sort: "review_asc",
              limit: 100,
            }
          )

        if (!ignoreResult) {
          setDecisions(data)
        }
      } catch (error) {
        console.error(error)

        if (!ignoreResult) {
          setDecisions([])
          setErrorMessage(
            getErrorMessage(
              error,
              "Action needed decisions could not be loaded."
            )
          )
        }
      } finally {
        if (!ignoreResult) {
          setLoading(false)
        }
      }
    }

    void loadActionNeeded(user.id)

    return () => {
      ignoreResult = true
    }
  }, [
      user?.id,
      activeWorkspaceId,
      workspaceVersion,
      loadRetryKey,
  ])

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        eyebrow="Follow-up queue"
        title="Action Needed"
        description="Resolve decisions with pending outcomes, pending learning, or overdue reviews."
        actions={
          <>
            <button
              type="button"
              onClick={() =>
                setLoadRetryKey((currentKey) =>
                  currentKey + 1
                )
              }
              disabled={loading}
              title="Refresh action needed decisions"
              aria-label="Refresh action needed decisions"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw
                size={16}
                className={loading ? "animate-spin" : undefined}
              />
              {loading ? "Refreshing..." : "Refresh"}
            </button>

            <div className="hidden rounded-xl bg-amber-50 p-2.5 text-amber-600 sm:block">
              <AlertCircle size={22} />
            </div>
          </>
        }
      />

      {errorMessage && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <span>{errorMessage}</span>

          <button
            type="button"
            onClick={() =>
              setLoadRetryKey((currentKey) =>
                currentKey + 1
              )
            }
            className="shrink-0 rounded-md border border-red-200 bg-white px-3 py-1.5 font-medium text-red-700 transition hover:border-red-300"
          >
            Try again
          </button>
        </div>
      )}

      <WorkspaceAccessNotice
        loading={loadingWorkspaceAccess}
        canManageWorkspaceData={canManageWorkspaceData}
        message="This is a read-only workspace. Open a decision to review its follow-up details; workspace managers handle updates."
        className="rounded-lg"
      />

      {loading ? (
        <div
          role="status"
          aria-live="polite"
          className="min-w-0 rounded-2xl border bg-white p-5 text-sm text-gray-500 shadow-sm sm:p-8"
        >
          Loading action needed decisions...
        </div>
      ) : errorMessage ? (
        <div
          role="status"
          className="min-w-0 rounded-2xl border border-red-200 bg-red-50 p-5 text-center sm:p-8"
        >
          <h2 className="text-xl font-semibold text-red-900">
            Action needed is unavailable
          </h2>

          <p className="mt-2 text-sm text-red-700">
            We could not load the follow-up queue. Use Try again above to reload it.
          </p>
        </div>
      ) : decisions.length === 0 ? (
        <div className="min-w-0 rounded-2xl border bg-white p-5 text-center shadow-sm sm:p-8">
          <h2 className="text-xl font-semibold">
            No action needed
          </h2>

          <p className="mt-2 text-sm text-gray-500">
            Pending outcomes, learning follow-ups and overdue reviews are clear.
          </p>

          <div className="mt-4 flex flex-col justify-center gap-3 sm:flex-row sm:flex-wrap">
            <Link
              href="/dashboard/decisions"
              className="inline-flex h-10 w-full items-center justify-center rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-600 transition hover:border-[var(--decisionate-brand-primary-ring)] hover:text-[var(--decisionate-brand-primary-text)] sm:w-auto"
            >
              View decisions
            </Link>

            {canManageWorkspaceData && (
              <Link
                href="/dashboard/decisions/new?returnTo=%2Fdashboard%2Faction-needed"
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[var(--decisionate-brand-primary)] px-3 text-sm font-medium text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90 sm:w-auto"
              >
                <Plus size={16} />
                New Decision
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div
            aria-label="Action needed filters"
            className="grid gap-2 sm:flex sm:flex-wrap"
          >
            {actionFilterOptions.map((option) => {
              const active =
                actionNeededFilter === option.key

              return (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    setActionNeededFilter(option.key)
                  }
                  className={`rounded-full border px-3 py-1.5 text-center text-sm font-medium transition ${
                    active
                      ? "border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] text-[var(--decisionate-brand-primary-text)]"
                      : "border-gray-200 bg-white text-gray-600 hover:border-[var(--decisionate-brand-primary-ring)] hover:text-[var(--decisionate-brand-primary-text)]"
                  }`}
                >
                  {option.label} ({option.count})
                </button>
              )
            })}
          </div>

          {visibleDecisions.length === 0 ? (
            <div className="rounded-2xl border bg-white p-5 text-center shadow-sm sm:p-8">
              <h2 className="text-lg font-semibold">
                No decisions in this slice
              </h2>

              <p className="mt-2 text-sm text-gray-500">
                Pick another queue filter to continue reviewing follow-up work.
              </p>

              <button
                type="button"
                onClick={() => setActionNeededFilter("all")}
                className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-600 transition hover:border-[var(--decisionate-brand-primary-ring)] hover:text-[var(--decisionate-brand-primary-text)] sm:w-auto"
              >
                Show all action-needed decisions
              </button>
            </div>
          ) : (
            <div className="grid gap-4">
              {visibleDecisions.map((decision) => (
                <ActionNeededDecisionCard
                  key={decision.id}
                  decision={decision}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ActionNeededDecisionCard({
  decision,
}: {
  decision: DecisionRecord
}) {
  const aiRecommendationSource =
    getAIRecommendationSource(
      decision.description
    )

  return (
    <Link
      href={`/dashboard/decisions/${decision.id}?focus=next-action&source=action-needed`}
      className="min-w-0 rounded-2xl border bg-white p-5 shadow-sm transition hover:border-[var(--decisionate-brand-primary-ring)] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--decisionate-brand-primary-ring)]"
    >
      <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h2 className="break-words text-lg font-semibold">
            {decision.title}
          </h2>

          <p className="mt-1 break-words text-sm text-gray-500 line-clamp-2">
            {decision.description ||
              "No description provided."}
          </p>
        </div>

        <span className="w-fit max-w-full shrink-0 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
          {formatDecisionLabel(
            decision.status
          )}
        </span>
      </div>

      <div className="mt-4 flex min-w-0 flex-wrap gap-2 text-xs font-medium">
        {getActionReasons(decision).map((reason) => (
          <span
            key={reason}
            className="max-w-full break-words rounded-full bg-[var(--decisionate-brand-primary-soft)] px-2.5 py-1 text-[var(--decisionate-brand-primary-text)]"
          >
            {reason}
          </span>
        ))}

        {decision.review_date && (
          <span className="inline-flex max-w-full items-start gap-1 rounded-full bg-gray-50 px-2.5 py-1 text-gray-600">
            <Calendar size={13} className="shrink-0" />
            <span className="break-words">
              {formatDecisionDate(
                decision.review_date
              )}
            </span>
          </span>
        )}

        {decision.metric_column && (
          <span className="inline-flex max-w-full items-start gap-1 rounded-full bg-[var(--decisionate-brand-primary-soft)] px-2.5 py-1 text-[var(--decisionate-brand-primary-text)]">
            <LineChart size={13} className="shrink-0" />
            <span className="break-words">
              Metric: {formatMetricLabel(decision.metric_column)}
            </span>
          </span>
        )}

        {aiRecommendationSource && (
          <span
            title={aiRecommendationSource}
            className="inline-flex max-w-full items-start gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-blue-700"
          >
            Analysis: {aiRecommendationSource}
          </span>
        )}
      </div>

      <span className="mt-4 inline-flex max-w-full items-center gap-2 break-words text-sm font-medium text-[var(--decisionate-brand-primary-text)]">
        <Target size={15} className="shrink-0" />
        Resolve next action →
      </span>
    </Link>
  )
}

function getVisibleActionNeededDecisions(
  decisions: DecisionRecord[],
  filter: ActionNeededFilter
) {
  if (filter === "overdue") {
    return decisions.filter(hasOverdueReview)
  }

  if (filter === "outcome") {
    return decisions.filter(hasPendingOutcome)
  }

  if (filter === "learning") {
    return decisions.filter(hasPendingLearning)
  }

  return decisions
}

function getActionReasons(
  decision: DecisionRecord
) {
  const reasons: string[] = []

  if (hasOverdueReview(decision)) {
    reasons.push("Review overdue")
  }

  if (hasPendingOutcome(decision)) {
    reasons.push("Outcome pending")
  }

  if (hasPendingLearning(decision)) {
    reasons.push("Learning pending")
  }

  return reasons
}

function hasOverdueReview(
  decision: DecisionRecord
) {
  const reviewDate =
    getDecisionDateValue(decision.review_date)

  if (!reviewDate) {
    return false
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return reviewDate < today
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
