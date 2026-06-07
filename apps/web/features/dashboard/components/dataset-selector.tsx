"use client"

import { useEffect, useState } from "react"
import { useUser } from "@clerk/nextjs"

import {
  getDatasets,
  updateDatasetPreference,
} from "@/lib/api"

interface Dataset {
  id: number
  file_name: string
}

interface DatasetSelectorProps {
  value?: number
  onChange: (id: number) => void
}

export function DatasetSelector({
  value,
  onChange,
}: DatasetSelectorProps) {
  const { user } = useUser()

  const [datasets, setDatasets] =
    useState<Dataset[]>([])

  useEffect(() => {
    if (!user?.id) return

    async function loadDatasets() {
      try {
        const data =
          await getDatasets(
            user?.id ?? ""
          )

        setDatasets(data)
      } catch (error) {
        console.error(error)
      }
    }

    loadDatasets()
  }, [user?.id])

  return (
    <select
      value={value ?? ""}
      onChange={async (e) => {
        const datasetId = Number(
          e.target.value
        )

        onChange(datasetId)

        if (user?.id) {
          try {
            await updateDatasetPreference(
              datasetId,
              user.id
            )
          } catch (error) {
            console.error(error)
          }
        }
      }}
      className="rounded-lg border px-3 py-2"
    >
      <option value="">
        Select Dataset
      </option>

      {datasets.map((dataset) => (
        <option
          key={dataset.id}
          value={dataset.id}
        >
          {dataset.file_name}
        </option>
      ))}
    </select>
  )
}