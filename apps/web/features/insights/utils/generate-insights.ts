import {
  calculateColumnMax,
  calculateColumnMin,
  getNumericColumns,
} from "@/features/datasets/utils/dataset-analytics"

import { DatasetRow } from "@/features/datasets/store/dataset-store"

export interface Insight {
  title: string
  description: string
}

export function generateInsights(
  rows: DatasetRow[]
): Insight[] {
  if (!rows.length) return []

  const numericColumns =
    getNumericColumns(rows)

  const insights: Insight[] = []

  numericColumns.forEach((column) => {
    const firstValue = Number(
      rows[0][column]
    )

    const lastValue = Number(
      rows[rows.length - 1][column]
    )

    if (
      !isNaN(firstValue) &&
      !isNaN(lastValue) &&
      firstValue !== 0
    ) {
      const growth =
        ((lastValue - firstValue) /
          firstValue) *
        100

      insights.push({
        title: `${column} trend`,
        description:
          growth >= 0
            ? `${column} increased by ${growth.toFixed(
                1
              )}% over the dataset period.`
            : `${column} decreased by ${Math.abs(
                growth
              ).toFixed(
                1
              )}% over the dataset period.`,
      })
    }

    const max = calculateColumnMax(
      rows,
      column
    )

    const min = calculateColumnMin(
      rows,
      column
    )

    insights.push({
      title: `${column} peak`,
      description: `Highest ${column} recorded was ${max.toLocaleString()}.`,
    })

    insights.push({
      title: `${column} low`,
      description: `Lowest ${column} recorded was ${min.toLocaleString()}.`,
    })
  })

  return insights
}