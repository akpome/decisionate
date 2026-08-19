"use client"

import { useState } from "react"
import { useUser } from "@clerk/nextjs"

import {
  importDatasetFromSignedUrl,
} from "@/lib/api"
import {
  useActiveWorkspace,
} from "@/lib/use-active-workspace"

type SignedUrlImportProps = {
  onImportSuccess: () => void
}

export function SignedUrlImport({
  onImportSuccess,
}: SignedUrlImportProps) {
  const { user } = useUser()
  const { activeWorkspaceId } =
    useActiveWorkspace(user?.id)
  const [url, setUrl] = useState("")
  const [fileName, setFileName] = useState("")
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState("")
  const [errorMessage, setErrorMessage] = useState("")

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault()

    if (!user?.id) {
      setErrorMessage("Sign in before importing a cloud file.")
      return
    }

    if (!url.trim()) {
      setErrorMessage("Paste a signed file URL first.")
      return
    }

    setLoading(true)
    setNotice("")
    setErrorMessage("")

    try {
      const result =
        await importDatasetFromSignedUrl(
          {
            url: url.trim(),
            ...(fileName.trim()
              ? { file_name: fileName.trim() }
              : {}),
          },
          user.id,
          activeWorkspaceId
        )
      setUrl("")
      setFileName("")
      setNotice(`Imported ${result.file_name}.`)
      await onImportSuccess()
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Cloud file import failed."
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-6 border-t border-gray-200 pt-6">
      <div>
        <h3 className="text-base font-semibold">
          Import from Google Drive or OneDrive
        </h3>
        <p className="mt-1 text-sm text-gray-500">
          Paste a signed download URL for a CSV, JSON, Excel, or Parquet file.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px_auto] sm:items-end"
      >
        <label className="min-w-0 text-sm font-medium text-gray-700">
          Signed file URL
          <input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://..."
            className="mt-1 block h-10 w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 text-sm font-normal text-gray-700"
          />
        </label>

        <label className="min-w-0 text-sm font-medium text-gray-700">
          File name (optional)
          <input
            type="text"
            value={fileName}
            onChange={(event) => setFileName(event.target.value)}
            placeholder="marketing.csv"
            className="mt-1 block h-10 w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 text-sm font-normal text-gray-700"
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          className="h-10 rounded-lg border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] px-4 text-sm font-medium text-[var(--decisionate-brand-primary-text)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Importing..." : "Import file"}
        </button>
      </form>

      {notice && (
        <p className="mt-3 text-sm text-green-700" role="status">
          {notice}
        </p>
      )}
      {errorMessage && (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  )
}
