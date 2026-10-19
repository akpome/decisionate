function isGeneratedJoinSummary(value: string) {
  return /^Joined evidence from \d+ datasets on normalized month-year periods using \w+ aggregation\. Shared periods:/.test(value) &&
    value.includes(". Columns: ") && value.includes(". Latest shared period (")
}

const legacyMetadataPrefixes = [
  "Latest shared period:", "Latest evidence:",
  "Derni\u00e8re p\u00e9riode commune :", "Derniers \u00e9l\u00e9ments probants :",
]
const legacyFooters = new Set([
  "Select an outcome metric in Decision Details only if this decision needs numeric outcome measurement.",
  "S\u00e9lectionnez une m\u00e9trique de r\u00e9sultat dans les d\u00e9tails de la d\u00e9cision uniquement si cette d\u00e9cision n\u00e9cessite une mesure num\u00e9rique du r\u00e9sultat.",
])

export function decisionNarrativeText(value: string | null | undefined) {
  const text = value ?? ""
  const paragraphs = text.split(/\r?\n[\t ]*\r?\n/)
  if (!paragraphs.some(paragraph => isGeneratedJoinSummary(paragraph.trim()))) return text
  // Old prose snapshots cannot establish values for a newly selected metric subset.
  return paragraphs.filter(paragraph => {
    const block = paragraph.trim()
    return !isGeneratedJoinSummary(block) && !legacyFooters.has(block) &&
      !legacyMetadataPrefixes.some(prefix => block.startsWith(prefix))
  }).join("\n\n").trim()
}
