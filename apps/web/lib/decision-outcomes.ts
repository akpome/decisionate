import type {
  DecisionRecord,
} from "@/lib/api"

function hasMeaningfulText(
  value?: string | null
) {
  return Boolean(
    value?.trim()
  )
}

function isActiveDecision(
  decision: DecisionRecord
) {
  return decision.status !== "archived"
}

export function hasPlannedOutcome(
  decision: DecisionRecord
) {
  return hasMeaningfulText(
    decision.expected_outcome
  )
}

export function hasRecordedOutcome(
  decision: DecisionRecord
) {
  return (
    hasMeaningfulText(decision.outcome_status) ||
    hasMeaningfulText(decision.actual_outcome)
  )
}

export function hasPendingOutcome(
  decision: DecisionRecord
) {
  return (
    isActiveDecision(decision) &&
    hasPlannedOutcome(decision) &&
    !hasRecordedOutcome(decision)
  )
}

export function hasCapturedLearning(
  decision: DecisionRecord
) {
  return hasMeaningfulText(
    decision.lessons_learned
  )
}

export function hasPendingLearning(
  decision: DecisionRecord
) {
  return (
    isActiveDecision(decision) &&
    hasRecordedOutcome(decision) &&
    !hasCapturedLearning(decision)
  )
}

export function hasAddedNotes(
  decision: DecisionRecord
) {
  return hasMeaningfulText(
    decision.notes
  )
}

export function hasPendingNotes(
  decision: DecisionRecord
) {
  return (
    isActiveDecision(decision) &&
    !hasAddedNotes(decision)
  )
}
