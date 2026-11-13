import type { BusinessReport } from "@/features/reports/types"

export function intelligenceDraft(report: BusinessReport | null, findingId: string) {
  const finding = report?.intelligence?.findings.find(item => item.id === findingId)
  const action = report?.intelligence?.recommendations.find(item => item.finding_id === findingId)
  if (!finding || !action) return null
  const active = report?.decisions.find(item => ["planned", "in_progress"].includes(item.status) && item.id === action.related_decision_id)
  return { findingId, title: finding.title, action: action.action, outcome: action.success_metric_id,
    reasoning: [finding.observation, `Evidence: ${finding.window.start} to ${finding.window.end}.`, ...finding.limitations].join("\n"),
    existingDecisionId: active?.id || action.related_decision_id }
}
