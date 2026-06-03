"use client"

import { useEffect, useState } from "react"
import { getDatasets } from "@/lib/api"
import Link from "next/link"

interface Dataset {
  id: number
  file_name: string
  row_count: number
  column_count: number
  created_at?: string
}

export function DatasetList() {
  const [datasets, setDatasets] =
    useState<Dataset[]>([])

  const [loading, setLoading] =
    useState(true)

  useEffect(() => {
    async function loadDatasets() {
      try {
        const data =
          await getDatasets()

        setDatasets(data)
      } catch (error) {
        console.error(
          "Failed to load datasets",
          error
        )
      } finally {
        setLoading(false)
      }
    }

    loadDatasets()
  }, [])

  if (loading) {
    return (
      <div className="rounded-xl border bg-white p-4">
        Loading datasets...
      </div>
    )
  }

  if (!datasets.length) {
    return (
      <div className="rounded-xl border bg-white p-4 text-gray-500">
        No datasets uploaded yet.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {datasets.map((dataset) => (

        <Link
            key={dataset.id}
            href={`/dashboard/datasets/${dataset.id}`}
            className="block rounded-xl border bg-white p-4 transition hover:bg-gray-50"
            >
            <div className="font-medium">
                {dataset.file_name}
            </div>

            <div className="mt-2 text-sm text-gray-500">
                {dataset.row_count} rows •{" "}
                {dataset.column_count} columns
            </div>
        </Link>
      ))}
    </div>
  )
}