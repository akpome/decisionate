"use client"

import { useEffect, useState } from "react"
import { getDatasets } from "@/lib/api"

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
  const [datasets, setDatasets] =
    useState<Dataset[]>([])

  useEffect(() => {
    async function loadDatasets() {
      const data =
        await getDatasets()

      setDatasets(data)
    }

    loadDatasets()
  }, [])

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