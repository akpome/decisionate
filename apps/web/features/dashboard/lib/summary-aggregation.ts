export type SummaryAggregationType =
  | "sum"
  | "count"
  | "avg"
  | "min"
  | "max"

export type SummaryAggregationRow = Record<string, unknown>

export type SummaryAggregationState = {
  sum: number
  count: number
  min: number | null
  max: number | null
}

export const historicalSummaryMarker =
  "__decisionate_summary__"

const summaryStatisticSuffixes = [
  "__mean",
  "__min",
  "__max",
  "__count",
  "__sum",
] as const

function toFiniteNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value !== "string" || !value.trim()) {
    return null
  }

  const numericValue = Number(
    value
      .trim()
      .replaceAll(/[$,%\s,]/g, "")
  )

  return Number.isFinite(numericValue)
    ? numericValue
    : null
}

export function isInternalSummaryColumn(column: string) {
  return (
    column === historicalSummaryMarker ||
    column === "__decisionate_summary_month__" ||
    summaryStatisticSuffixes.some(suffix =>
      column.endsWith(suffix)
    )
  )
}

export function isHistoricalSummaryRow(
  row: SummaryAggregationRow
) {
  return (
    row[historicalSummaryMarker] === true ||
    row[historicalSummaryMarker] === 1 ||
    row[historicalSummaryMarker] === "true"
  )
}

function firstFiniteValue(
  row: SummaryAggregationRow,
  columns: string[]
) {
  for (const column of columns) {
    const value = toFiniteNumber(row[column])

    if (value !== null) {
      return value
    }
  }

  return null
}

export function getSummaryAggregationState(
  row: SummaryAggregationRow,
  metric: string
): SummaryAggregationState | null {
  if (isHistoricalSummaryRow(row)) {
    const count = firstFiniteValue(row, [
      `${metric}__count`,
    ])
    const sum = firstFiniteValue(row, [
      `${metric}__sum`,
      metric,
    ])
    const mean = firstFiniteValue(row, [
      `${metric}__mean`,
    ])
    const resolvedCount = count ?? (
      sum !== null || mean !== null ? 1 : 0
    )
    const resolvedSum = sum ?? (
      mean !== null
        ? mean * resolvedCount
        : 0
    )
    const minimum = firstFiniteValue(row, [
      `${metric}__min`,
      metric,
    ])
    const maximum = firstFiniteValue(row, [
      `${metric}__max`,
      metric,
    ])

    if (resolvedCount <= 0 && minimum === null && maximum === null) {
      return null
    }

    return {
      sum: resolvedSum,
      count: resolvedCount,
      min: minimum,
      max: maximum,
    }
  }

  const value = toFiniteNumber(row[metric])

  return value === null
    ? null
    : {
      sum: value,
      count: 1,
      min: value,
      max: value,
    }
}

export function mergeSummaryAggregationState(
  current: SummaryAggregationState | undefined,
  next: SummaryAggregationState
) {
  if (!current) {
    return { ...next }
  }

  return {
    sum: current.sum + next.sum,
    count: current.count + next.count,
    min: current.min === null
      ? next.min
      : next.min === null
        ? current.min
        : Math.min(current.min, next.min),
    max: current.max === null
      ? next.max
      : next.max === null
        ? current.max
        : Math.max(current.max, next.max),
  }
}

export function finalizeSummaryAggregation(
  state: SummaryAggregationState | undefined,
  aggregationType: SummaryAggregationType
) {
  if (!state || state.count <= 0) {
    return 0
  }

  if (aggregationType === "avg") {
    return state.sum / state.count
  }

  if (aggregationType === "min") {
    return state.min ?? 0
  }

  if (aggregationType === "max") {
    return state.max ?? 0
  }

  if (aggregationType === "count") {
    return state.count
  }

  return state.sum
}

export function aggregateSummaryAwareValues(
  rows: SummaryAggregationRow[],
  metric: string,
  aggregationType: SummaryAggregationType
) {
  let state: SummaryAggregationState | undefined

  rows.forEach(row => {
    const next = getSummaryAggregationState(row, metric)

    if (next) {
      state = mergeSummaryAggregationState(state, next)
    }
  })

  return finalizeSummaryAggregation(
    state,
    aggregationType
  )
}

export function getHistoricalDimensionWarning(
  rows: SummaryAggregationRow[],
  dimensions: Array<string | undefined>
) {
  const historicalRows = rows.filter(isHistoricalSummaryRow)
  const unavailableDimensions = Array.from(
    new Set(
      dimensions.filter(
        dimension => {
          if (!dimension) return false
          return historicalRows.every(row => {
            const value = row[dimension]
            return value === null || value === undefined || value === ""
          })
        }
      )
    )
  )

  if (!historicalRows.length || !unavailableDimensions.length) {
    return ""
  }

  return `Detailed values for ${unavailableDimensions.join(", ")} are unavailable for data older than 24 months because high-cardinality fields are not retained in historical summaries.`
}
