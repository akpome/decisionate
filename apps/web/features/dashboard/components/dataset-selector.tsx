"use client"

import { useEffect, useState } from "react"
import { getDatasets } from "@/lib/api"
import { useUser } from "@clerk/nextjs"

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
      onChange={(e) =>
        onChange(Number(e.target.value))
      }
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