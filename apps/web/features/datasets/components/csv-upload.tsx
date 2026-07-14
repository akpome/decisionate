"use client"

import {
  useRef,
  useState,
} from "react"
import {
  type DatasetSourceOption,
  uploadDataset,
} from "@/lib/api"
import { useUser } from "@clerk/nextjs"
import {
  useActiveWorkspace,
} from "@/lib/use-active-workspace"

interface CsvUploadProps {
  sources?: DatasetSourceOption[]
  onUploadSuccess: () => void
}

const uploadFileExtensions: Record<string, string[]> = {
  csv: [".csv"],
  json: [
    ".json",
    ".jsonl",
  ],
  parquet: [
    ".parquet",
    ".pq",
  ],
  excel: [
    ".xls",
    ".xlsx",
  ],
}

const fallbackUploadSource: Pick<
  DatasetSourceOption,
  "type" | "label"
> = {
  type: "csv",
  label: "CSV",
}

export function CsvUpload({
  sources = [],
  onUploadSuccess,
}: CsvUploadProps) {
  const { user } = useUser()
  const { activeWorkspaceId } =
    useActiveWorkspace(user?.id)

  const [fileName, setFileName] = useState("")
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] =
    useState("")
  const fileInputRef =
    useRef<HTMLInputElement | null>(null)
  const uploadSources =
    sources.filter(
      (source) =>
        source.connection_type === "upload"
    )
  const availableUploadSources =
    uploadSources.filter(
      (source) =>
        source.status === "available"
    )
  const setupUploadSources =
    uploadSources.filter(
      (source) =>
        source.status === "needs_setup"
    )
  const effectiveUploadSources =
    availableUploadSources.length > 0
      ? availableUploadSources
      : [
          fallbackUploadSource,
        ]
  const acceptedExtensions =
    effectiveUploadSources.flatMap(
      (source) =>
        uploadFileExtensions[
          source.type
        ] || []
    )
  const acceptedFormatLabel =
    formatUploadSourceLabels(
      effectiveUploadSources
    )
  const setupFormatLabel =
    formatUploadSourceLabels(
      setupUploadSources
    )

  async function handleFileUpload(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0]

    if (!file) return

    if (!user?.id) {
      setFileName("")
      setErrorMessage(
        "Sign in before uploading a dataset."
      )
      event.target.value = ""
      return
    }

    setFileName(file.name)
    setErrorMessage("")
    setLoading(true)

    try {
      await uploadDataset(
        file,
        user.id,
        activeWorkspaceId
      )
      await onUploadSuccess()
    } catch (error) {
      setFileName("")
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Upload failed"
      )
    } finally {
      setLoading(false)

      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    }
  }

  return (
    <div className="space-y-6">
      {/* Upload Area */}
      <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center transition hover:bg-gray-100">
        <div className="space-y-2">
          <p className="text-lg font-medium">
            Upload Data File
          </p>

          <p className="text-sm text-gray-500">
            {acceptedFormatLabel}
          </p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept={acceptedExtensions.join(
            ","
          )}
          className="hidden"
          onChange={handleFileUpload}
        />
      </label>

      {setupFormatLabel && (
        <div className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p>
            {setupFormatLabel} need setup on the API server before upload.
          </p>

          {setupUploadSources.map(
            (source) =>
              source.availability_note && (
                <p
                  key={source.type}
                  className="text-xs"
                >
                  {source.label}:{" "}
                  {
                    source.availability_note
                  }
                </p>
              )
          )}
        </div>
      )}

      {/* Upload State */}
      {loading && (
        <div className="rounded-xl border bg-gray-50 p-4 text-sm text-gray-600">
          Uploading data file...
        </div>
      )}

      {errorMessage && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      {/* File Info */}
      {fileName && !loading && (
        <div className="rounded-xl border bg-white p-4">
          <p className="font-medium">
            Uploaded File
          </p>

          <p className="mt-1 text-sm text-gray-500">
            {fileName}
          </p>
        </div>
      )}
    </div>
  )
}

function formatUploadSourceLabels(
  sources: Pick<
    DatasetSourceOption,
    "label" | "type"
  >[]
) {
  const labels = sources.map(
    (source) => source.label
  )

  if (labels.length === 0) {
    return ""
  }

  if (labels.length === 1) {
    return labels[0]
  }

  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`
  }

  return `${labels
    .slice(0, -1)
    .join(", ")}, or ${
    labels[labels.length - 1]
  }`
}
