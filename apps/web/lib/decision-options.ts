import type {
  DecisionActivityType,
  DecisionCategory,
  DecisionConfidenceScore,
  DecisionListLifecycle,
  DecisionListSort,
  DecisionOutcomeStatus,
  DecisionPriority,
  DecisionStatus,
} from "@/lib/api"

type DecisionOption<T extends string> = {
  value: T
  label: string
}

export function formatDecisionLabel(
  value: string | null | undefined
) {
  if (!value) return "Pending"

  return value
    .replaceAll("_", " ")
    .replace(
      /\b\w/g,
      (char: string) => char.toUpperCase()
    )
}

export const defaultDecisionStatus = "planned" satisfies DecisionStatus
export const inProgressDecisionStatus =
  "in_progress" satisfies DecisionStatus
export const completedDecisionStatus = "completed" satisfies DecisionStatus
export const cancelledDecisionStatus = "cancelled" satisfies DecisionStatus
export const archivedDecisionStatus = "archived" satisfies DecisionStatus
export const defaultDecisionCategory = "general" satisfies DecisionCategory
export const marketingDecisionCategory =
  "marketing" satisfies DecisionCategory
export const salesDecisionCategory = "sales" satisfies DecisionCategory
export const operationsDecisionCategory =
  "operations" satisfies DecisionCategory
export const financeDecisionCategory = "finance" satisfies DecisionCategory
export const hiringDecisionCategory = "hiring" satisfies DecisionCategory
export const productDecisionCategory = "product" satisfies DecisionCategory
export const successfulDecisionOutcome =
  "successful" satisfies DecisionOutcomeStatus
export const partiallySuccessfulDecisionOutcome =
  "partially_successful" satisfies DecisionOutcomeStatus
export const unsuccessfulDecisionOutcome =
  "unsuccessful" satisfies DecisionOutcomeStatus
export const allPortfolioLifecycle = "all" satisfies DecisionListLifecycle
export const defaultPortfolioLifecycle =
  "active" satisfies DecisionListLifecycle
export const archivedPortfolioLifecycle =
  "archived" satisfies DecisionListLifecycle
export const defaultDecisionSort = "created_desc" satisfies DecisionListSort
export const updatedDecisionSort = "updated_desc" satisfies DecisionListSort
export const createdAscDecisionSort =
  "created_asc" satisfies DecisionListSort
export const reviewAscDecisionSort = "review_asc" satisfies DecisionListSort
export const reviewDescDecisionSort = "review_desc" satisfies DecisionListSort
export const createdDecisionActivity =
  "created" satisfies DecisionActivityType
export const statusDecisionActivity = "status" satisfies DecisionActivityType
export const archiveDecisionActivity =
  "archive" satisfies DecisionActivityType
export const restoreDecisionActivity =
  "restore" satisfies DecisionActivityType
export const overviewDecisionActivity =
  "overview" satisfies DecisionActivityType
export const detailsDecisionActivity =
  "details" satisfies DecisionActivityType
export const notesDecisionActivity = "notes" satisfies DecisionActivityType
export const outcomeDecisionActivity =
  "outcome" satisfies DecisionActivityType
export const learningDecisionActivity =
  "learning" satisfies DecisionActivityType
export const reviewDecisionActivity = "review" satisfies DecisionActivityType
export const priorityDecisionActivity =
  "priority" satisfies DecisionActivityType
export const categoryDecisionActivity =
  "category" satisfies DecisionActivityType
export const confidenceDecisionActivity =
  "confidence" satisfies DecisionActivityType
export const highDecisionPriority = "high" satisfies DecisionPriority
export const mediumDecisionPriority = "medium" satisfies DecisionPriority
export const lowDecisionPriority = "low" satisfies DecisionPriority
export const defaultDecisionPriority =
  mediumDecisionPriority satisfies DecisionPriority
export const highDecisionConfidence =
  "high" satisfies DecisionConfidenceScore
export const mediumDecisionConfidence =
  "medium" satisfies DecisionConfidenceScore
export const lowDecisionConfidence =
  "low" satisfies DecisionConfidenceScore

export type ActiveDecisionStatus = Exclude<
  DecisionStatus,
  typeof archivedDecisionStatus
>

export const decisionStatusOptions: DecisionOption<DecisionStatus>[] = [
  {
    value: defaultDecisionStatus,
    label: "Planned",
  },
  {
    value: inProgressDecisionStatus,
    label: "In Progress",
  },
  {
    value: completedDecisionStatus,
    label: "Completed",
  },
  {
    value: cancelledDecisionStatus,
    label: "Cancelled",
  },
  {
    value: archivedDecisionStatus,
    label: "Archived",
  },
]

export const activeDecisionStatusOptions: DecisionOption<
  ActiveDecisionStatus
>[] = decisionStatusOptions.filter(
  (
    option
  ): option is DecisionOption<
    ActiveDecisionStatus
  > => option.value !== archivedDecisionStatus
)

export const decisionPriorityOptions: DecisionOption<DecisionPriority>[] = [
  {
    value: highDecisionPriority,
    label: "High",
  },
  {
    value: mediumDecisionPriority,
    label: "Medium",
  },
  {
    value: lowDecisionPriority,
    label: "Low",
  },
]

export const decisionCategoryOptions: DecisionOption<DecisionCategory>[] = [
  {
    value: defaultDecisionCategory,
    label: "General",
  },
  {
    value: marketingDecisionCategory,
    label: "Marketing",
  },
  {
    value: salesDecisionCategory,
    label: "Sales",
  },
  {
    value: operationsDecisionCategory,
    label: "Operations",
  },
  {
    value: financeDecisionCategory,
    label: "Finance",
  },
  {
    value: hiringDecisionCategory,
    label: "Hiring",
  },
  {
    value: productDecisionCategory,
    label: "Product",
  },
]

export const decisionOutcomeStatusOptions: DecisionOption<
  DecisionOutcomeStatus
>[] = [
  {
    value: successfulDecisionOutcome,
    label: "Successful",
  },
  {
    value: partiallySuccessfulDecisionOutcome,
    label: "Partially Successful",
  },
  {
    value: unsuccessfulDecisionOutcome,
    label: "Unsuccessful",
  },
]

export const decisionConfidenceOptions: DecisionOption<
  DecisionConfidenceScore
>[] = [
  {
    value: highDecisionConfidence,
    label: "High",
  },
  {
    value: mediumDecisionConfidence,
    label: "Medium",
  },
  {
    value: lowDecisionConfidence,
    label: "Low",
  },
]

export const decisionSortOptions: DecisionOption<DecisionListSort>[] = [
  {
    value: defaultDecisionSort,
    label: "Newest first",
  },
  {
    value: updatedDecisionSort,
    label: "Recently updated",
  },
  {
    value: createdAscDecisionSort,
    label: "Oldest first",
  },
  {
    value: reviewAscDecisionSort,
    label: "Review soonest",
  },
  {
    value: reviewDescDecisionSort,
    label: "Review latest",
  },
]
