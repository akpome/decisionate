import type {
  DecisionRecord,
} from "@/lib/api"
import {
  archivedDecisionStatus,
  cancelledDecisionStatus,
  completedDecisionStatus,
  inProgressDecisionStatus,
} from "@/lib/decision-options"
import {
  hasCapturedLearning,
  hasRecordedOutcome,
} from "@/lib/decision-outcomes"

export const healthyDecisionHealthLabel = "Healthy"
export const needsReviewDecisionHealthLabel = "Needs Review"
export const archivedDecisionHealthLabel = "Archived"
export const inProgressDecisionHealthLabel = "In Progress"
export const cancelledDecisionHealthLabel = "Cancelled"
export const plannedDecisionHealthLabel = "Planned"

export type DecisionHealthLabel =
  | typeof healthyDecisionHealthLabel
  | typeof needsReviewDecisionHealthLabel
  | typeof archivedDecisionHealthLabel
  | typeof inProgressDecisionHealthLabel
  | typeof cancelledDecisionHealthLabel
  | typeof plannedDecisionHealthLabel

export function getDecisionHealth(
  decision: DecisionRecord,
  currentDate = new Date()
): DecisionHealthLabel {
  if (decision.status === archivedDecisionStatus) {
    return archivedDecisionHealthLabel
  }

  const today = new Date(currentDate)
  today.setHours(0, 0, 0, 0)

  const reviewDate = getDecisionDateValue(
    decision.review_date
  )

  if (reviewDate && reviewDate < today) {
    return needsReviewDecisionHealthLabel
  }

  if (
    decision.status === completedDecisionStatus &&
    hasRecordedOutcome(decision) &&
    hasCapturedLearning(decision)
  ) {
    return healthyDecisionHealthLabel
  }

  if (decision.status === inProgressDecisionStatus) {
    return inProgressDecisionHealthLabel
  }

  if (decision.status === cancelledDecisionStatus) {
    return cancelledDecisionHealthLabel
  }

  return plannedDecisionHealthLabel
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
