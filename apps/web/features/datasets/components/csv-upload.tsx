"use client"

import { useRef } from "react"
import {
  type DatasetSourceOption,
  waitForDataIngestionJob,
  uploadDataset,
} from "@/lib/api"
import { useUser } from "@clerk/nextjs"
import { CircleCheck, LoaderCircle, Upload } from "lucide-react"
import {
  useActiveWorkspace,
} from "@/lib/use-active-workspace"
import { useDecisionateText } from "@/app/use-decisionate-language"

interface CsvUploadProps {
  sources?: DatasetSourceOption[]
  busy: boolean
  onStatusChange: (status: DatasetUploadStatus) => void
  onUploadSuccess: () => void | Promise<void>
}

export type DatasetUploadStatus =
  | { phase: "uploading" | "processing" | "complete"; fileName: string }
  | { phase: "error"; fileName: string; message: string }

export function isDatasetUploadBusy(status: DatasetUploadStatus | null) {
  return status?.phase === "uploading" || status?.phase === "processing"
}

export function DatasetUploadNotice({ status }: { status: DatasetUploadStatus | null }) {
  const { t } = useDecisionateText()
  const notice = status?.phase !== "error" ? status : null
  const busy = isDatasetUploadBusy(notice)
  const label = t(notice?.phase === "uploading" ? "Uploading data file..." : notice?.phase === "processing" ? "Preparing your dataset..." : "Uploaded File")
  return (
    <>
      <div role="status" aria-atomic="true" className={notice ? "min-w-0 rounded-lg border border-[var(--decisionate-brand-primary)] bg-[var(--decisionate-brand-primary-soft)] px-4 py-3" : "sr-only"}>
        {notice && (
          <>
            <div className="flex items-start gap-3">
              {busy ? (
                <LoaderCircle size={22} strokeWidth={2.5} className="shrink-0 animate-spin text-[var(--decisionate-brand-primary-text,#1d4ed8)] motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <CircleCheck size={22} className="shrink-0 text-[var(--decisionate-brand-primary-text,#1d4ed8)]" aria-hidden="true" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">{label}</p>
                <p className="break-all text-sm text-gray-600">{notice.fileName}</p>
              </div>
            </div>
            {busy && <progress aria-label={label} className="mt-2 block h-1.5 w-full accent-[var(--decisionate-brand-primary)] motion-reduce:hidden" />}
          </>
        )}
      </div>
      {status?.phase === "error" && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {status.fileName && <p className="mb-1 break-all font-medium">{status.fileName}</p>}
          {status.message}
        </div>
      )}
    </>
  )
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
  busy,
  onStatusChange,
  onUploadSuccess,
}: CsvUploadProps) {
  const { t } = useDecisionateText()
  const { user } = useUser()
  const { activeWorkspaceId } =
    useActiveWorkspace(user?.id)

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
  const uploadHelpId =
    "dataset-upload-help"

  async function handleFileUpload(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0]

    if (!file || busy) return

    if (!user?.id) {
      onStatusChange({ phase: "error", fileName: "", message: t("Sign in before uploading a dataset.") })
      event.target.value = ""
      return
    }

    const fileName = file.name
    if (!acceptedExtensions.some(extension => file.name.trim().toLowerCase().endsWith(extension))) {
      onStatusChange({ phase: "error", fileName, message: t("This file format is not supported.") })
      event.target.value = ""
      return
    }
    onStatusChange({ phase: "uploading", fileName })

    try {
      const queuedJob = await uploadDataset(
        file,
        user.id,
        activeWorkspaceId
      )
      onStatusChange({ phase: "processing", fileName })
      if (
        queuedJob.status === "queued" &&
        queuedJob.job_id
      ) {
        await waitForDataIngestionJob(
          queuedJob.job_id,
          user.id,
          activeWorkspaceId
        )
      }
      await onUploadSuccess()
      onStatusChange({ phase: "complete", fileName })
    } catch (error) {
      onStatusChange({ phase: "error", fileName, message: error instanceof Error ? error.message : t("Upload failed") })
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    }
  }

  return (
    <div className="space-y-6">
      {/* Upload Area */}
      <label
        htmlFor="dataset-file-upload"
        className={`flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white px-4 py-8 text-center transition focus-within:border-[var(--decisionate-brand-primary)] focus-within:ring-2 focus-within:ring-[var(--decisionate-brand-primary-ring)] ${busy ? "cursor-wait opacity-60" : "cursor-pointer hover:bg-gray-50"}`}
      >
        <div className="w-full min-w-0 space-y-2">
          <Upload size={24} className="mx-auto text-gray-400" aria-hidden="true" />
          <p className="text-sm font-medium">{t("Upload Data File")}</p>
          <p
            id={uploadHelpId}
            className="text-sm text-gray-500"
          >
            {acceptedFormatLabel}
          </p>
        </div>

        <input
          id="dataset-file-upload"
          ref={fileInputRef}
          type="file"
          disabled={busy}
          accept={acceptedExtensions.join(
            ","
          )}
          aria-label={t("Upload Data File")}
          aria-describedby={uploadHelpId}
          className="sr-only"
          onChange={handleFileUpload}
        />
      </label>

      {setupFormatLabel && (
        <div className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p>
            {setupFormatLabel} {t("need workspace setup before upload.")}
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
