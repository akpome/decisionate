"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useUser } from "@clerk/nextjs"
import {
  AlertCircle,
  Calendar,
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
  const [decisions, setDecisions] =
    useState<DecisionRecord[]>([])
  const [loading, setLoading] =
    useState(false)
  const [errorMessage, setErrorMessage] =
    useState("")

  useEffect(() => {
    if (!user?.id) return

    let ignoreResult = false

    async function loadActionNeeded(
      userId: string
    ) {
      try {
        setLoading(true)
        setErrorMessage("")

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
  ])

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border bg-white p-8 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-amber-600">
              Follow-up queue
            </p>

            <h1 className="mt-2 text-3xl font-bold tracking-tight">
              Action Needed
            </h1>

            <p className="mt-3 max-w-3xl text-gray-600">
              Resolve decisions with pending outcomes, pending learning, or overdue reviews.
            </p>
          </div>

          <div className="rounded-2xl bg-amber-50 p-3 text-amber-600">
            <AlertCircle size={28} />
          </div>
        </div>
      </div>

      {errorMessage && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border bg-white p-8 text-sm text-gray-500 shadow-sm">
          Loading action needed decisions...
        </div>
      ) : decisions.length === 0 ? (
        <div className="rounded-2xl border bg-white p-8 text-center shadow-sm">
          <h2 className="text-xl font-semibold">
            No action needed
          </h2>

          <p className="mt-2 text-sm text-gray-500">
            Pending outcomes, learning follow-ups and overdue reviews are clear.
          </p>

          <Link
            href="/dashboard/decisions"
            className="mt-4 inline-flex rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition hover:border-blue-200 hover:text-blue-700"
          >
            View decisions
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {decisions.map((decision) => (
            <Link
              key={decision.id}
              href={`/dashboard/decisions/${decision.id}?focus=next-action`}
              className="rounded-2xl border bg-white p-5 shadow-sm transition hover:border-blue-200 hover:shadow-md"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">
                    {decision.title}
                  </h2>

                  <p className="mt-1 line-clamp-2 text-sm text-gray-500">
                    {decision.description ||
                      "No description provided."}
                  </p>
                </div>

                <span className="shrink-0 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                  {formatDecisionLabel(
                    decision.status
                  )}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium">
                {getActionReasons(decision).map((reason) => (
                  <span
                    key={reason}
                    className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700"
                  >
                    {reason}
                  </span>
                ))}

                {decision.review_date && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2.5 py-1 text-gray-600">
                    <Calendar size={13} />
                    {formatDecisionDate(
                      decision.review_date
                    )}
                  </span>
                )}
              </div>

              <span className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-blue-600">
                <Target size={15} />
                Resolve next action →
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
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
