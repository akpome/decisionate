"use client"

import { useEffect, useState } from "react"

import { DatasetSelector } from "@/features/dashboard/components/dataset-selector"
import { InsightCard } from "@/features/insights/components/insight-card"
import type {
  Insight,
} from "@/features/insights/utils/generate-insights"

import { useUser } from "@clerk/nextjs"

import {
  getDatasetDetails,
  getDatasets,
  getDatasetPreference,
  type DatasetSummary,
} from "@/lib/api"
import {
  useActiveWorkspace,
} from "@/lib/use-active-workspace"
import {
  getDatasetSourceDetails,
} from "@/features/datasets/lib/source-config"

type InsightDataset = DatasetSummary & {
  insights?: Insight[]
}

function getInsightsPageErrorMessage(
  error: unknown,
  fallbackMessage: string
) {
  return error instanceof Error &&
    error.message
    ? error.message
    : fallbackMessage
}

export default function InsightsPage() {
  const [selectedDatasetId, setSelectedDatasetId] =
    useState<number>()

  const [dataset, setDataset] =
    useState<InsightDataset | null>(null)

  const { user } = useUser()
  const {
    activeWorkspaceId,
    workspaceVersion,
  } =
    useActiveWorkspace(user?.id)

  const [loading, setLoading] =
    useState(false)
  const [pageError, setPageError] =
    useState("")

  const insights =
    dataset?.insights ?? []
  const datasetSourceDetails =
    dataset
      ? getDatasetSourceDetails(
          dataset.source_type,
          dataset.source_config,
          dataset.source_label
        )
      : null

  useEffect(() => {
    if (!user?.id) return
    const userId = user.id

    async function loadDefaultDataset() {
      try {
        setDataset(null)
        setSelectedDatasetId(undefined)
        setPageError("")

        const preference =
          await getDatasetPreference(
            userId,
            activeWorkspaceId
          )

        if (
          preference.selected_dataset_id
        ) {
          setSelectedDatasetId(
            preference.selected_dataset_id
          )

          return
        }

        const datasets =
          await getDatasets(
            userId,
            activeWorkspaceId
          )

        if (datasets.length > 0) {
          setSelectedDatasetId(
            datasets[0].id
          )
        }
      } catch (error) {
        console.error(error)
        setDataset(null)
        setSelectedDatasetId(undefined)
        setPageError(
          getInsightsPageErrorMessage(
            error,
            "Unable to load your saved insights dataset."
          )
        )
      }
    }

    loadDefaultDataset()
  }, [
    user?.id,
    activeWorkspaceId,
    workspaceVersion,
  ])


  useEffect(() => {
    if (!selectedDatasetId) {
      return
    }

    if (!user?.id) return
    const userId = user.id
    const datasetId = selectedDatasetId

    async function loadDataset() {
      try {
        setLoading(true)
        setPageError("")

        const data =
          await getDatasetDetails(
            datasetId,
            userId,
            activeWorkspaceId
          )

        setDataset(data)
      } catch (error) {
        console.error(error)
        setDataset(null)
        setPageError(
          getInsightsPageErrorMessage(
            error,
            "Unable to load insights for this dataset."
          )
        )
      } finally {
        setLoading(false)
      }
    }

    loadDataset()
  }, [
    selectedDatasetId,
    activeWorkspaceId,
    user?.id,
    workspaceVersion,
  ])

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">
          Insights
        </h1>

        <div className="mt-4">
          <DatasetSelector
            value={selectedDatasetId}
            onChange={(datasetId) => {
              setDataset(null)
              setPageError("")
              setSelectedDatasetId(datasetId)
            }}
          />
        </div>

        <p className="mt-2 text-gray-500">
          {dataset
            ? `Insights generated from ${dataset.file_name} • ${datasetSourceDetails?.label}`
            : "Select a dataset"
          }
        </p>
      </div>

      {pageError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
          {pageError}
        </div>
      )}

      {!selectedDatasetId && (
        <div className="rounded-2xl border border-dashed bg-white p-12 text-center">
          <h2 className="text-xl font-semibold">
            No dataset selected
          </h2>

          <p className="mt-2 text-gray-500">
            Select a dataset to view insights.
          </p>
        </div>
      )}

      {loading && (
        <div className="rounded-xl border bg-white p-6">
          Loading insights...
        </div>
      )}

      {insights.length > 0 && (
        <div className="grid gap-6 md:grid-cols-2">
          {insights.map(
            (
              insight,
              index: number
            ) => (
              <InsightCard
                key={index}
                insight={insight}
              />
            )
          )}
        </div>
      )}
    </div>
  )
}
