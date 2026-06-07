"use client"

import { useEffect, useState } from "react"

import { DatasetSelector } from "@/features/dashboard/components/dataset-selector"
import { InsightCard } from "@/features/insights/components/insight-card"

import { useUser } from "@clerk/nextjs"

import {
  getDatasetDetails,
  getDatasets,
  getDatasetPreference,
} from "@/lib/api"

export default function InsightsPage() {
  const [selectedDatasetId, setSelectedDatasetId] =
    useState<number>()

  const [dataset, setDataset] =
    useState<any>(null)

  const { user } = useUser()

  const [loading, setLoading] =
    useState(false)

  useEffect(() => {
    if (!user?.id) return
    const userId = user.id

    async function loadDefaultDataset() {
      try {
        const preference =
          await getDatasetPreference(
            userId
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
            userId
          )

        if (datasets.length > 0) {
          setSelectedDatasetId(
            datasets[0].id
          )
        }
      } catch (error) {
        console.error(error)
      }
    }

    loadDefaultDataset()
  }, [user?.id])


  useEffect(() => {
    if (!selectedDatasetId) return

    if (!user?.id) return
    const userId = user.id
    const datasetId = selectedDatasetId

    async function loadDataset() {
      try {
        setLoading(true)

        const data =
          await getDatasetDetails(
            datasetId,
            userId
          )

        setDataset(data)
      } catch (error) {
        console.error(error)
      } finally {
        setLoading(false)
      }
    }

    loadDataset()
  }, [selectedDatasetId, user?.id])

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">
          Insights
        </h1>

        <div className="mt-4">
          <DatasetSelector
            value={selectedDatasetId}
            onChange={setSelectedDatasetId}
          />
        </div>

        <p className="mt-2 text-gray-500">
          {dataset
            ? `Insights generated from ${dataset.file_name}`
            : "Select a dataset"
          }
        </p>
      </div>

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

      {dataset?.insights?.length > 0 && (
        <div className="grid gap-6 md:grid-cols-2">
          {dataset.insights.map(
            (
              insight: any,
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
