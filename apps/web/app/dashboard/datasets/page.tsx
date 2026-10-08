"use client"

import { useEffect, useState } from "react"
import { useUser } from "@clerk/nextjs"
import Link from "next/link"
import { Link2, Plug, Plus, RefreshCw, Upload, X } from "lucide-react"

import { ConnectionPullWidget } from "@/features/datasets/components/connection-pull-widget"
import { CsvUpload } from "@/features/datasets/components/csv-upload"
import { SignedUrlImport } from "@/features/datasets/components/signed-url-import"
import { DatasetList } from "@/features/datasets/components/dataset-list"
import { DashboardPageHeader } from "@/features/dashboard/components/dashboard-page-header"
import {
  getDataSourceConnections,
  getDatasetSources,
  getDatasets,
  type DataSourceConnection,
  type DatasetSourceOption,
  type DatasetSummary,
} from "@/lib/api"
import {
  useActiveWorkspace,
} from "@/lib/use-active-workspace"
import {
  useWorkspaceAccess,
} from "@/lib/use-workspace-access"
import {
  WorkspaceAccessNotice,
} from "@/features/dashboard/components/workspace-access-notice"
import { useDecisionateText } from "@/app/use-decisionate-language"

function getErrorMessage(
  error: unknown,
  fallback: string
) {
  return error instanceof Error &&
    error.message
    ? error.message
    : fallback
}

export default function DatasetsPage() {
  const { t } = useDecisionateText()
  const [datasets, setDatasets] =
    useState<DatasetSummary[]>([])
  const [sources, setSources] =
    useState<DatasetSourceOption[]>([])
  const [connections, setConnections] =
    useState<DataSourceConnection[]>([])
  const [datasetError, setDatasetError] =
    useState("")
  const [loadingDatasets, setLoadingDatasets] =
    useState(true)
  const [sourceError, setSourceError] =
    useState("")
  const [connectionError, setConnectionError] =
    useState("")
  const [initialDataRetryKey, setInitialDataRetryKey] =
    useState(0)
  const [showImportTools, setShowImportTools] = useState(false)
  const [importMode, setImportMode] = useState("file")

  const { user } = useUser()
  const {
    activeWorkspaceId,
    workspaceVersion,
  } =
    useActiveWorkspace(user?.id)
  const {
    canConfigureWorkspace,
    canViewConnections,
    loadingWorkspaceAccess,
  } =
    useWorkspaceAccess(user?.id)

  async function loadDatasets() {
    if (!user?.id) return

    setLoadingDatasets(true)

    try {
      const data =
        await getDatasets(
          user.id,
          activeWorkspaceId,
          user.primaryEmailAddress?.emailAddress
        )

      setDatasets(data)
      setDatasetError("")
    } catch (error) {
      setDatasetError(
        getErrorMessage(
          error,
          "Could not load datasets."
        )
      )
    } finally {
      setLoadingDatasets(false)
    }
  }

  useEffect(() => {
    if (!user?.id) return

    let ignoreResult = false

    async function loadInitialData(
      userId: string
    ) {
      setDatasets([])
      setDatasetError("")
      setLoadingDatasets(true)

      const [datasetsResult] =
        await Promise.allSettled([
          getDatasets(
            userId,
            activeWorkspaceId,
            user?.primaryEmailAddress?.emailAddress
          ),
        ])

      if (ignoreResult) {
        return
      }

      if (datasetsResult.status === "fulfilled") {
        setDatasets(datasetsResult.value)
        setDatasetError("")
      } else {
        setDatasetError(
          getErrorMessage(
            datasetsResult.reason,
            "Could not load datasets."
          )
        )
      }

      setLoadingDatasets(false)

    }

    void loadInitialData(user.id)

    return () => {
      ignoreResult = true
    }
  }, [
    user?.id,
    user?.primaryEmailAddress?.emailAddress,
    activeWorkspaceId,
    initialDataRetryKey,
    workspaceVersion,
  ])

  useEffect(() => {
    if (
      !user?.id ||
      !canViewConnections
    ) {
      return
    }

    let ignoreResult = false

    async function loadSourceData(
      userId: string
    ) {
      setSources([])
      setConnections([])
      setSourceError("")
      setConnectionError("")

      const [
        sourcesResult,
        connectionsResult,
      ] = await Promise.allSettled([
        getDatasetSources(
          userId,
          activeWorkspaceId
        ),
        getDataSourceConnections(
          userId,
          activeWorkspaceId
        ),
      ])

      if (ignoreResult) {
        return
      }

      if (sourcesResult.status === "fulfilled") {
        setSources(sourcesResult.value)
        setSourceError("")
      } else {
        setSourceError(
          getErrorMessage(
            sourcesResult.reason,
            "Could not load upload source options."
          )
        )
      }

      if (
        connectionsResult.status === "fulfilled"
      ) {
        setConnections(connectionsResult.value)
        setConnectionError("")
      } else {
        setConnectionError(
          getErrorMessage(
            connectionsResult.reason,
            "Could not load saved connections."
          )
        )
      }
    }

    void loadSourceData(user.id)

    return () => {
      ignoreResult = true
    }
  }, [
    activeWorkspaceId,
    canConfigureWorkspace,
    canViewConnections,
    initialDataRetryKey,
    user?.id,
    workspaceVersion,
  ])

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Datasets"
        actions={<>
          {canViewConnections && <Link href="/dashboard/connections" className="inline-flex h-10 items-center gap-2 rounded-lg border bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"><Plug size={16} aria-hidden="true" />{t("Connections")}</Link>}
          {(canConfigureWorkspace || canViewConnections) && <button type="button" aria-expanded={showImportTools} aria-controls="dataset-import-tools" onClick={() => setShowImportTools(current => !current)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--decisionate-brand-primary)] px-4 text-sm font-medium text-[var(--decisionate-brand-primary-surface-text)] hover:opacity-90">
            {showImportTools ? <X size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}{t(showImportTools ? "Close import" : "Add data")}
          </button>}
        </>}
      />

      <WorkspaceAccessNotice
        loading={loadingWorkspaceAccess}
        canManageWorkspaceData={canConfigureWorkspace}
        message="This shared workspace is read-only. The business owner handles dataset uploads, connections, and changes."
        className="rounded-lg"
      />

      {sourceError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {sourceError}
        </div>
      )}

      {datasetError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {datasetError}
        </div>
      )}

      {connectionError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {connectionError}
        </div>
      )}

      {(sourceError || datasetError || connectionError) && (
        <button
          type="button"
          onClick={() =>
            setInitialDataRetryKey(
              currentKey => currentKey + 1
            )
          }
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          <RefreshCw size={16} aria-hidden="true" />
          {t("Retry data services")}
        </button>
      )}

      {(canConfigureWorkspace || canViewConnections) && (
        <section id="dataset-import-tools" hidden={!showImportTools} className="border-t pt-5">
          <div role="tablist" aria-label={t("Import method")} className="mb-5 flex gap-1 border-b">
            {[
              ...(canConfigureWorkspace ? [{ value: "file", label: "Upload file", icon: Upload }, { value: "link", label: "Import link", icon: Link2 }] : []),
              ...(canViewConnections ? [{ value: "connection", label: "Connection", icon: Plug }] : []),
            ].map(({ value, label, icon: Icon }) => {
              const selected = importMode === value || (!canConfigureWorkspace && value === "connection")
              return <button key={value} id={`import-tab-${value}`} type="button" role="tab" aria-selected={selected} aria-controls={`import-panel-${value}`} tabIndex={selected ? 0 : -1}
                onClick={() => setImportMode(value)}
                onKeyDown={event => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
                  event.preventDefault()
                  const tabs = Array.from(event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
                  const index = tabs.indexOf(event.currentTarget)
                  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length
                  tabs[next].click()
                  tabs[next].focus()
                }}
                className={`inline-flex min-h-11 min-w-0 items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium ${selected ? "border-[var(--decisionate-brand-primary)] text-[var(--decisionate-brand-primary-text)]" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
                <Icon size={16} className="hidden shrink-0 sm:block" aria-hidden="true" />{t(label)}
              </button>
            })}
          </div>
          {canConfigureWorkspace && <>
            <div id="import-panel-file" role="tabpanel" aria-labelledby="import-tab-file" hidden={importMode !== "file"}><CsvUpload sources={sources} onUploadSuccess={loadDatasets} /></div>
            <div id="import-panel-link" role="tabpanel" aria-labelledby="import-tab-link" hidden={importMode !== "link"}><SignedUrlImport onImportSuccess={loadDatasets} /></div>
          </>}
          {canViewConnections && <div id="import-panel-connection" role="tabpanel" aria-labelledby="import-tab-connection" hidden={canConfigureWorkspace && importMode !== "connection"}>
            <ConnectionPullWidget connections={connections} loadError={Boolean(connectionError)} />
          </div>}
        </section>
      )}

      <section aria-label={t("Saved Datasets")}>
        {loadingDatasets ? (
          <div role="status" aria-live="polite" aria-busy="true" className="space-y-3">
            <span className="sr-only">{t("Loading datasets...")}</span>
            <div aria-hidden="true" className="h-16 animate-pulse rounded-lg bg-gray-200/60" />
            {[0, 1, 2].map(row => <div key={row} aria-hidden="true" className="h-20 animate-pulse rounded-lg bg-gray-100" />)}
          </div>
        ) : (
          <DatasetList datasets={datasets} canDelete={canConfigureWorkspace} canManage={canConfigureWorkspace} loadError={Boolean(datasetError)} onRefresh={loadDatasets} />
        )}
      </section>
    </div>
  )
}
