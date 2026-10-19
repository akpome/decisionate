type DecisionTitle = { title: string; action?: string | null }

function isLegacyEvidenceTitle(title: string) {
  // Match old generated placeholders, not deliberately named review actions.
  return title === "Review joined dataset evidence" || title === "Review generated insight" ||
    title.startsWith("Review joined evidence:")
}

export function isLegacyEvidencePlaceholder(decision: DecisionTitle) {
  const action = decision.action?.trim()
  return isLegacyEvidenceTitle(decision.title.trim()) && (!action || isLegacyEvidenceTitle(action) ||
    action === "Review the joined metrics and agree on the next action.")
}

export function getDecisionDisplayTitle(decision: DecisionTitle) {
  return isLegacyEvidencePlaceholder(decision) ? "Decision action not recorded" : decision.title
}
