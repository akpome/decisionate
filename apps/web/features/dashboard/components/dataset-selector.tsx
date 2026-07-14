"use client"

import { useEffect, useState } from "react"
import { useUser } from "@clerk/nextjs"

import {
  type DatasetSummary,
  getDatasets,
  updateDatasetPreference,
} from "@/lib/api"
import {
  useActiveWorkspace,
} from "@/lib/use-active-workspace"
import {
  getDatasetSourceDetails,
} from "@/features/datasets/lib/source-config"

interface DatasetSelectorProps {
  value?: number
  onChange: (id: number | undefined) => void
}

function getSelectedDatasetId(
  value: string
) {
  if (!value) {
    return undefined
  }

  const datasetId = Number(value)

  return Number.isInteger(datasetId) &&
    datasetId > 0
    ? datasetId
    : undefined
}

export function DatasetSelector({
  value,
  onChange,
}: DatasetSelectorProps) {
  const { user } = useUser()
  const {
    activeWorkspaceId,
    workspaceVersion,
  } =
    useActiveWorkspace(user?.id)

  const [datasets, setDatasets] =
    useState<DatasetSummary[]>([])
  const [errorMessage, setErrorMessage] =
    useState("")

  useEffect(() => {
    if (!user?.id) return

    const userId = user.id

    async function loadDatasets() {
      try {
        const data =
          await getDatasets(
            userId,
            activeWorkspaceId
          )

        setDatasets(data)
        setErrorMessage("")
      } catch (error) {
        setErrorMessage(
          error instanceof Error &&
            error.message
            ? error.message
            : "Failed to load datasets"
        )
        console.error(error)
      }
    }

    loadDatasets()
  }, [
    activeWorkspaceId,
    user?.id,
    workspaceVersion,
  ])

  return (
    <div className="space-y-2">
      <select
        value={value ?? ""}
        onChange={async (e) => {
          const datasetId =
            getSelectedDatasetId(
              e.target.value
            )

          onChange(datasetId)

          if (user?.id && datasetId) {
            try {
              await updateDatasetPreference(
                datasetId,
                user.id,
                undefined,
                undefined,
                undefined,
                activeWorkspaceId
              )
              setErrorMessage("")
            } catch (error) {
              setErrorMessage(
                error instanceof Error &&
                  error.message
                  ? error.message
                  : "Failed to save dataset preference"
              )
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
            {formatDatasetOptionLabel(
              dataset
            )}
          </option>
        ))}
      </select>

      {errorMessage && (
        <p className="text-sm text-red-700">
          {errorMessage}
        </p>
      )}
    </div>
  )
}

function formatDatasetOptionLabel(
  dataset: DatasetSummary
) {
  const sourceDetails =
    getDatasetSourceDetails(
      dataset.source_type,
      dataset.source_config,
      dataset.source_label
    )

  return `${dataset.file_name} (${sourceDetails.label})`
}
