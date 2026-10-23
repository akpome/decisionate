"use client"

import { useEffect, useState } from "react"
import { getDatasetDetails, type DimensionFilter } from "@/lib/api"

export function sameDimensionFilter(left?: DimensionFilter | null, right?: DimensionFilter | null) {
  return (left?.column || "") === (right?.column || "") && JSON.stringify(left?.values || []) === JSON.stringify(right?.values || [])
}

export function useDashboardDimensionData<T extends { id?: number }>(dataset: T | null, datasetId: number | undefined,
  userId: string, workspaceId: string | undefined, filter: DimensionFilter | undefined, context: string) {
  const [result, setResult] = useState<{ key: string; data?: T; error?: string }>()
  const [retry, setRetry] = useState(0)
  const signature = JSON.stringify(filter || null)
  const key = `${userId}:${workspaceId}:${datasetId}:${context}:${signature}:${retry}`
  useEffect(() => {
    if (!datasetId || !userId || dataset?.id !== datasetId || !filter?.values.length) return
    let active = true
    const timer = setTimeout(() => {
      void getDatasetDetails(datasetId, userId, workspaceId, { includeAllRows: true, includeAIAnalysis: false, dimensionFilter: filter })
        .then(data => { if (active) setResult({ key, data }) })
        .catch(error => { if (active) setResult({ key, error: error instanceof Error ? error.message : "The filtered dashboard could not be loaded." }) })
    }, 200)
    return () => { active = false; clearTimeout(timer) }
  }, [datasetId, dataset?.id, userId, workspaceId, filter, key])
  const current = result?.key === key ? result : undefined
  return { data: filter ? current?.data || null : dataset, pending: Boolean(filter?.values.length && !current),
    error: current?.error || "", retry: () => setRetry(value => value + 1) }
}
