import { DatasetRow } from "../store/dataset-store"

export function getNumericColumns(
  rows: DatasetRow[]
): string[] {
  if (!rows.length) return []

  return Object.keys(rows[0]).filter((key) =>
    rows.some((row) => {
      const value = row[key]

      return (
        value !== null &&
        value !== "" &&
        !isNaN(Number(value))
      )
    })
  )
}

export function getTextColumns(
  rows: DatasetRow[]
): string[] {
  if (!rows.length) return []

  return Object.keys(rows[0]).filter((key) =>
    rows.some((row) => {
      const value = row[key]

      return (
        typeof value === "string" &&
        isNaN(Number(value))
      )
    })
  )
}

export function calculateColumnTotal(
  rows: DatasetRow[],
  column: string
): number {
  return rows.reduce((total, row) => {
    const value = Number(row[column])

    if (isNaN(value)) return total

    return total + value
  }, 0)
}

export function calculateColumnAverage(
  rows: DatasetRow[],
  column: string
): number {
  const values = rows
    .map((row) => Number(row[column]))
    .filter((value) => !isNaN(value))

  if (!values.length) return 0

  const total = values.reduce(
    (sum, value) => sum + value,
    0
  )

  return total / values.length
}

export function calculateColumnMax(
  rows: DatasetRow[],
  column: string
): number {
  const values = rows
    .map((row) => Number(row[column]))
    .filter((value) => !isNaN(value))

  if (!values.length) return 0

  return Math.max(...values)
}

export function calculateColumnMin(
  rows: DatasetRow[],
  column: string
): number {
  const values = rows
    .map((row) => Number(row[column]))
    .filter((value) => !isNaN(value))

  if (!values.length) return 0

  return Math.min(...values)
}

export function formatMetricValue(
  value: number
): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value)
}

export function generateDatasetMetrics(
  rows: DatasetRow[]
) {
  const numericColumns =
    getNumericColumns(rows)

  return numericColumns.map((column) => {
    const total = calculateColumnTotal(
      rows,
      column
    )

    const average =
      calculateColumnAverage(rows, column)

    const max = calculateColumnMax(
      rows,
      column
    )

    const min = calculateColumnMin(
      rows,
      column
    )

    return {
      column,
      total,
      average,
      max,
      min,
    }
  })
}

export function inferPrimaryMetric(
  rows: DatasetRow[]
) {
  const numericColumns =
    getNumericColumns(rows)

  if (!numericColumns.length) {
    return null
  }

  const metrics =
    generateDatasetMetrics(rows)

  return metrics.sort(
    (a, b) => b.total - a.total
  )[0]
}