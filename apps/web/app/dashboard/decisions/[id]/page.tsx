"use client"

import {
  useEffect,
  useState,
} from "react"

import Link from "next/link"

import {
  useParams,
} from "next/navigation"

import {
  useUser,
} from "@clerk/nextjs"

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

export default function DecisionPage() {
  const params =
    useParams()

  const { user } =
    useUser()

  const [decision,
    setDecision] =
    useState<any>(null)

  const [status,
    setStatus] =
    useState("")

  const [originalStatus,
    setOriginalStatus] =
    useState("")

  const [priority,
    setPriority] =
    useState("")

  const [originalPriority,
    setOriginalPriority] =
    useState("")

  const [category,
    setCategory] =
    useState("")

  const [originalCategory,
    setOriginalCategory] =
    useState("")

  const [reviewDate,
    setReviewDate] =
    useState("")

  const [originalReviewDate,
    setOriginalReviewDate] =
    useState("")

  const [overviewSaved,
    setOverviewSaved] =
    useState(false)

  const [notes,
    setNotes] =
    useState("")

  const [originalNotes,
    setOriginalNotes] =
    useState("")

  const [noteSaved,
    setNoteSaved] =
    useState(false)

  const [expectedOutcome,
    setExpectedOutcome] =
    useState("")

  const [originalExpectedOutcome,
    setOriginalExpectedOutcome] =
    useState("")

  const [actualOutcome,
    setActualOutcome] =
    useState("")

  const [originalActualOutcome,
    setOriginalActualOutcome] =
    useState("")

  const [outcomeStatus,
    setOutcomeStatus] =
    useState("")

  const [originalOutcomeStatus,
    setOriginalOutcomeStatus] =
    useState("")

  const [outcomeSaved,
    setOutcomeSaved] =
    useState(false)

  const [lessonsLearned,
    setLessonsLearned] =
    useState("")

  const [originalLessonsLearned,
    setOriginalLessonsLearned] =
    useState("")

  const [learningSaved,
    setLearningSaved] =
    useState(false)

  useEffect(() => {
    if (!user?.id) return

    const userId =
      user.id

    async function load() {
      try {
        const data =
          await getDecision(
            Number(params.id),
            userId
          )

        setDecision(data)

        setStatus(
          data.status ?? "planned"
        )

        setOriginalStatus(
          data.status ?? "planned"
        )

        setPriority(
          data.priority ?? "medium"
        )

        setOriginalPriority(
          data.priority ?? "medium"
        )

        setCategory(
          data.category ?? "general"
        )

        setOriginalCategory(
          data.category ?? "general"
        )

        setReviewDate(
          data.review_date
            ? data.review_date.split("T")[0]
            : ""
        )

        setOriginalReviewDate(
          data.review_date
            ? data.review_date.split("T")[0]
            : ""
        )

        setNotes(
          data.notes ?? ""
        )

        setOriginalNotes(
          data.notes ?? ""
        )

        setExpectedOutcome(
          data.expected_outcome ?? ""
        )

        setOriginalExpectedOutcome(
          data.expected_outcome ?? ""
        )

        setActualOutcome(
          data.actual_outcome ?? ""
        )

        setOriginalActualOutcome(
          data.actual_outcome ?? ""
        )

        setOutcomeStatus(
          data.outcome_status ?? ""
        )

        setOriginalOutcomeStatus(
          data.outcome_status ?? ""
        )

        setLessonsLearned(
          data.lessons_learned ?? ""
        )

        setOriginalLessonsLearned(
          data.lessons_learned ?? ""
        )
      } catch (error) {
        console.error(error)
      }
    }

    load()

  }, [
    params.id,
    user?.id,
  ])

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
    expectedOutcome !==
    originalExpectedOutcome ||
    actualOutcome !==
    originalActualOutcome ||
    outcomeStatus !==
    originalOutcomeStatus

  const learningChanged =
    lessonsLearned !==
    originalLessonsLearned

  async function handleSaveOverview() {
    if (!user?.id || !decision) return

    try {
      let updatedDecision =
        decision

      if (statusChanged) {
        updatedDecision =
          await updateDecision(
            decision.id,
            status,
            user.id
          )

        setOriginalStatus(
          status
        )
      }

      if (priorityChanged) {
        updatedDecision =
          await updateDecisionPriority(
            decision.id,
            priority,
            user.id
          )

        setOriginalPriority(
          priority
        )
      }

      if (categoryChanged) {
        updatedDecision =
          await updateDecisionCategory(
            decision.id,
            category,
            user.id
          )

        setOriginalCategory(
          category
        )
      }

      if (reviewDateChanged) {
        updatedDecision =
          await updateDecisionReviewDate(
            decision.id,
            reviewDate
              ? `${reviewDate}T00:00:00`
              : "",
            user.id
          )

        setOriginalReviewDate(
          reviewDate
        )
      }

      setDecision(
        updatedDecision
      )

      setOverviewSaved(true)

      setTimeout(() => {
        setOverviewSaved(false)
      }, 3000)
    } catch (error) {
      console.error(error)
    }

  }

  async function handleSaveNote() {
    if (!user?.id || !decision) return

    try {
      const data =
        await updateDecisionNotes(
          decision.id,
          notes,
          user.id
        )

      setDecision(data)

      setOriginalNotes(
        notes
      )

      setNoteSaved(true)

      setTimeout(() => {
        setNoteSaved(false)
      }, 3000)
    } catch (error) {
      console.error(error)
    }

  }

  async function handleSaveOutcome() {
    if (!user?.id || !decision) return

    try {
      const data =
        await updateDecisionOutcome(
          decision.id,
          {
            expected_outcome:
              expectedOutcome,

            actual_outcome:
              actualOutcome,

            outcome_status:
              outcomeStatus,
          },
          user.id
        )

      setDecision(data)

      setOriginalExpectedOutcome(
        expectedOutcome
      )

      setOriginalActualOutcome(
        actualOutcome
      )

      setOriginalOutcomeStatus(
        outcomeStatus
      )

      setOutcomeSaved(true)

      setTimeout(() => {
        setOutcomeSaved(false)
      }, 3000)
    } catch (error) {
      console.error(error)
    }

  }

  async function handleSaveLearning() {
    if (!user?.id || !decision) return

    try {
      const data =
        await updateDecisionLearning(
          decision.id,
          lessonsLearned,
          user.id
        )

      setDecision(data)

      setOriginalLessonsLearned(
        lessonsLearned
      )

      setLearningSaved(true)

      setTimeout(() => {
        setLearningSaved(false)
      }, 3000)
    } catch (error) {
      console.error(error)
    }

  }

  if (!decision) {
    return (
      <div>
        Loading...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/decisions"
        className="text-sm text-gray-500 hover:text-gray-700"
      >
        ← Back to Decisions
      </Link>

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <h1 className="text-3xl font-bold">
          {decision.title}
        </h1>

        <p className="mt-3 text-gray-700">
          {decision.description || "No description provided."}
        </p>

        <div className="mt-4 flex flex-wrap gap-6 text-sm">
          <div>
            <p className="text-gray-500">Outcome</p>
            <p className="font-medium">
              {decision.outcome_status || "Pending"}
            </p>
          </div>

          <div>
            <p className="text-gray-500">Created</p>
            <p className="font-medium">
              {new Date(decision.created_at).toLocaleDateString()}
            </p>
          </div>

          {decision.dataset_id && (
            <div>
              <p className="text-gray-500">Dataset ID</p>
              <p className="font-medium">
                {decision.dataset_id}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-semibold">
            Decision Overview
          </h2>

          {overviewSaved && (
            <p className="text-sm text-green-600">
              Overview saved
            </p>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-4">
          <div>
            <p className="text-sm text-gray-500">Status</p>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="mt-2 w-full rounded border p-2"
            >
              <option value="planned">Planned</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div>
            <p className="text-sm text-gray-500">Priority</p>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="mt-2 w-full rounded border p-2"
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>

          <div>
            <p className="text-sm text-gray-500">Category</p>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-2 w-full rounded border p-2"
            >
              <option value="general">General</option>
              <option value="marketing">Marketing</option>
              <option value="sales">Sales</option>
              <option value="operations">Operations</option>
              <option value="finance">Finance</option>
              <option value="hiring">Hiring</option>
              <option value="product">Product</option>
            </select>
          </div>

          <div>
            <p className="text-sm text-gray-500">Review Date</p>
            <input
              type="date"
              value={reviewDate}
              onChange={(e) => setReviewDate(e.target.value)}
              className="mt-2 w-full rounded border p-2"
            />
          </div>
        </div>

        <button
          onClick={handleSaveOverview}
          disabled={!overviewChanged}
          className={`mt-4 rounded border px-4 py-2 ${!overviewChanged
            ? "cursor-not-allowed opacity-50"
            : "cursor-pointer hover:bg-gray-50"
            }`}
        >
          Save Overview
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Notes</h2>

            {noteSaved && (
              <p className="text-sm text-green-600">
                Note saved
              </p>
            )}
          </div>

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={7}
            className="mt-4 w-full rounded border p-3"
          />

          <button
            onClick={handleSaveNote}
            disabled={!noteChanged}
            className={`mt-3 rounded border px-4 py-2 ${!noteChanged
              ? "cursor-not-allowed opacity-50"
              : "cursor-pointer hover:bg-gray-50"
              }`}
          >
            Save Note
          </button>
        </div>

        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Learning</h2>

            {learningSaved && (
              <p className="text-sm text-green-600">
                Learning saved
              </p>
            )}
          </div>

          <textarea
            value={lessonsLearned}
            onChange={(e) => setLessonsLearned(e.target.value)}
            rows={7}
            className="mt-4 w-full rounded border p-3"
          />

          <button
            onClick={handleSaveLearning}
            disabled={!learningChanged}
            className={`mt-3 rounded border px-4 py-2 ${!learningChanged
              ? "cursor-not-allowed opacity-50"
              : "cursor-pointer hover:bg-gray-50"
              }`}
          >
            Save Learning
          </button>
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">
            Outcome Tracking
          </h2>

          {outcomeSaved && (
            <p className="text-sm text-green-600">
              Outcome saved
            </p>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <p className="text-sm text-gray-500">
              Expected Outcome
            </p>

            <textarea
              value={expectedOutcome}
              onChange={(e) =>
                setExpectedOutcome(e.target.value)
              }
              rows={5}
              className="mt-2 w-full rounded border p-3"
            />
          </div>

          <div>
            <p className="text-sm text-gray-500">
              Actual Outcome
            </p>

            <textarea
              value={actualOutcome}
              onChange={(e) =>
                setActualOutcome(e.target.value)
              }
              rows={5}
              className="mt-2 w-full rounded border p-3"
            />
          </div>
        </div>

        <div className="mt-4 max-w-sm">
          <p className="text-sm text-gray-500">
            Outcome Status
          </p>

          <select
            value={outcomeStatus}
            onChange={(e) =>
              setOutcomeStatus(e.target.value)
            }
            className="mt-2 w-full rounded border p-2"
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
        </div>

        <button
          onClick={handleSaveOutcome}
          disabled={!outcomeChanged}
          className={`mt-4 rounded border px-4 py-2 ${!outcomeChanged
            ? "cursor-not-allowed opacity-50"
            : "cursor-pointer hover:bg-gray-50"
            }`}
        >
          Save Outcome
        </button>
      </div>
    </div>
  )
} 