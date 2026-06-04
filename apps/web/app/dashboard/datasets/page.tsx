"use client"

import { useEffect, useState } from "react"

import { CsvUpload } from "@/features/datasets/components/csv-upload"
import { DatasetList } from "@/features/datasets/components/dataset-list"
import { useUser } from "@clerk/nextjs"

import { getDatasets } from "@/lib/api"

export default function DatasetsPage() {
  const [datasets, setDatasets] =
    useState([])

  const { user } = useUser()

  async function loadDatasets() {
    if (!user?.id) return

    try {
      const data =
        await getDatasets(
          user.id
        )

      setDatasets(data)
    } catch (error) {
      console.error(error)
    }
  }

  useEffect(() => {
    if (!user?.id) return

    loadDatasets()
  }, [user?.id])

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">
          Datasets
        </h1>

        <p className="mt-2 text-gray-500">
          Upload and manage your business data.
        </p>
      </div>

      <div className="rounded-2xl border bg-white p-8 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold">
          Upload CSV
        </h2>

        <p className="mb-6 text-sm text-gray-500">
          Upload a CSV file to begin generating insights and dashboards.
        </p>

        <CsvUpload
          onUploadSuccess={
            loadDatasets
          }
        />
      </div>

      <div className="rounded-2xl border bg-white p-8 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold">
          Saved Datasets
        </h2>

        <DatasetList
          datasets={datasets}
          onRefresh={
            loadDatasets
          }
        />
      </div>
    </div>
  )
}