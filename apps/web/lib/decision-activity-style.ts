import type {
  DecisionActivityType,
} from "@/lib/api"
import {
  archiveDecisionActivity,
  categoryDecisionActivity,
  confidenceDecisionActivity,
  createdDecisionActivity,
  detailsDecisionActivity,
  learningDecisionActivity,
  notesDecisionActivity,
  outcomeDecisionActivity,
  overviewDecisionActivity,
  priorityDecisionActivity,
  restoreDecisionActivity,
  reviewDecisionActivity,
  statusDecisionActivity,
} from "@/lib/decision-options"

type DecisionActivityStyle = {
  dotClass: string
  badgeClass: string
  titleClass: string
}

const blueActivityStyle: DecisionActivityStyle = {
  dotClass: "bg-blue-500",
  badgeClass: "bg-blue-50 text-blue-700",
  titleClass: "text-blue-700",
}

const greenActivityStyle: DecisionActivityStyle = {
  dotClass: "bg-green-500",
  badgeClass: "bg-green-50 text-green-700",
  titleClass: "text-green-700",
}

const amberActivityStyle: DecisionActivityStyle = {
  dotClass: "bg-amber-500",
  badgeClass: "bg-amber-50 text-amber-700",
  titleClass: "text-amber-700",
}

const priorityActivityStyle: DecisionActivityStyle = {
  dotClass: "bg-red-500",
  badgeClass: "bg-red-50 text-red-700",
  titleClass: "text-red-700",
}

const categoryActivityStyle: DecisionActivityStyle = {
  dotClass: "bg-purple-500",
  badgeClass: "bg-purple-50 text-purple-700",
  titleClass: "text-purple-700",
}

const confidenceActivityStyle: DecisionActivityStyle = {
  dotClass: "bg-indigo-500",
  badgeClass: "bg-indigo-50 text-indigo-700",
  titleClass: "text-indigo-700",
}

const archiveActivityStyle: DecisionActivityStyle = {
  dotClass: "bg-gray-500",
  badgeClass: "bg-gray-100 text-gray-700",
  titleClass: "",
}

const decisionActivityStyles: Record<
  DecisionActivityType,
  DecisionActivityStyle
> = {
  [createdDecisionActivity]: blueActivityStyle,
  [statusDecisionActivity]: blueActivityStyle,
  [detailsDecisionActivity]: blueActivityStyle,
  [notesDecisionActivity]: blueActivityStyle,
  [outcomeDecisionActivity]: greenActivityStyle,
  [learningDecisionActivity]: greenActivityStyle,
  [restoreDecisionActivity]: greenActivityStyle,
  [reviewDecisionActivity]: amberActivityStyle,
  [overviewDecisionActivity]: amberActivityStyle,
  [priorityDecisionActivity]: priorityActivityStyle,
  [categoryDecisionActivity]: categoryActivityStyle,
  [confidenceDecisionActivity]: confidenceActivityStyle,
  [archiveDecisionActivity]: archiveActivityStyle,
}

/* =========================
   Decision Activity Visual Style Helpers For Portfolio And Detail Timelines
========================= */

export function getDecisionActivityDotClass(
  activityType: DecisionActivityType
) {
  return getDecisionActivityStyle(
    activityType
  ).dotClass
}

export function getDecisionActivityBadgeClass(
  activityType: DecisionActivityType
) {
  return getDecisionActivityStyle(
    activityType
  ).badgeClass
}

export function getDecisionActivityTitleClass(
  activityType: DecisionActivityType
) {
  return getDecisionActivityStyle(
    activityType
  ).titleClass
}

function getDecisionActivityStyle(
  activityType: DecisionActivityType
) {
  return decisionActivityStyles[activityType]
}
