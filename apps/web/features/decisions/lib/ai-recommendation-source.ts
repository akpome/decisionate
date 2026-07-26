export function getAIRecommendationSource(
  description?: string | null
) {
  const stableSourceMatch = description?.match(
    /(?:^|\n\n)Decisionate AI source:\s*(.+)$/
  )

  if (stableSourceMatch?.[1]) {
    return stableSourceMatch[1].trim()
  }

  const legacySourceMatch = description?.match(
    /(?:^|\n\n)Recommendation:\s*[\s\S]*\n\nSource:\s*(.+)$/
  )

  return legacySourceMatch?.[1]?.trim() || undefined
}
