"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { useUser } from "@clerk/nextjs"
import { useRouter } from "next/navigation"
import {
  Check,
  ClipboardCheck,
  Database,
  LayoutDashboard,
  Unlink,
} from "lucide-react"

import {
  getDashboardPreference,
  getAllDatasetSharingStatus,
  stopAllDatasetSharing,
  updateDashboardPreference,
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
import { DashboardPageHeader } from "@/features/dashboard/components/dashboard-page-header"
import {
  dashboardGroups,
  defaultDashboardKey,
  isDashboardKey,
  type DashboardDefinition,
  type DashboardPreviewTone,
} from "@/features/dashboards/dashboard-definitions"

async function loadWorkspaceSharingEnabled(
  userId: string,
  activeWorkspaceId: string
) {
  const status =
    await getAllDatasetSharingStatus(
      userId,
      activeWorkspaceId
    )

  return {
    enabled: status.share_enabled,
    count: status.shares_active,
  }
}

export default function DashboardsPage() {
  const { user } = useUser()
  const userId = user?.id
  const router = useRouter()
  const {
    activeWorkspaceId,
    workspaceVersion,
  } = useActiveWorkspace(userId)
  const {
    canConfigureWorkspace,
    loadingWorkspaceAccess,
  } = useWorkspaceAccess(userId)
  const [selectedDashboard, setSelectedDashboard] =
    useState(defaultDashboardKey)
  const [loadingPreference, setLoadingPreference] =
    useState(true)
  const [savingDashboard, setSavingDashboard] =
    useState("")
  const [stoppingAllSharing, setStoppingAllSharing] =
    useState(false)
  const [
    dashboardSharingEnabled,
    setDashboardSharingEnabled,
  ] = useState(false)
  const [
    activeSharingCount,
    setActiveSharingCount,
  ] = useState(0)
  const [shareStatus, setShareStatus] =
    useState("")
  const shareStatusTimeoutRef =
    useRef<number | null>(null)
  const [error, setError] = useState("")
  const [preferenceError, setPreferenceError] =
    useState("")
  const [preferenceRetryKey, setPreferenceRetryKey] =
    useState(0)
  const [sharingStatusError, setSharingStatusError] =
    useState("")
  const [sharingStatusRetryKey, setSharingStatusRetryKey] =
    useState(0)
  const dashboardPreferenceLoading =
    Boolean(userId) && loadingPreference

  function setTemporaryShareStatus(
    status: string,
    duration = 3500
  ) {
    if (shareStatusTimeoutRef.current) {
      window.clearTimeout(
        shareStatusTimeoutRef.current
      )
    }

    setShareStatus(status)

    shareStatusTimeoutRef.current =
      window.setTimeout(() => {
        setShareStatus("")
        shareStatusTimeoutRef.current = null
      }, duration)
  }

  useEffect(() => {
    return () => {
      if (shareStatusTimeoutRef.current) {
        window.clearTimeout(
          shareStatusTimeoutRef.current
        )
      }
    }
  }, [])

  useEffect(() => {
    if (!userId) {
      return
    }

    const cleanUserId = userId

    let cancelled = false

    async function loadPreference() {
      setLoadingPreference(true)

      try {
        const preference =
          await getDashboardPreference(
            cleanUserId,
            activeWorkspaceId
          )

        if (!cancelled) {
          setPreferenceError("")
          setSelectedDashboard(
            isDashboardKey(
              preference.selected_dashboard
            )
              ? preference.selected_dashboard
              : defaultDashboardKey
          )
        }
      } catch (preferenceErrorValue) {
        if (!cancelled) {
          setSelectedDashboard(defaultDashboardKey)
          setPreferenceError(
            preferenceErrorValue instanceof Error &&
              preferenceErrorValue.message
              ? preferenceErrorValue.message
              : "Dashboard preference could not be loaded."
          )
        }
      } finally {
        if (!cancelled) {
          setLoadingPreference(false)
        }
      }
    }

    void loadPreference()

    return () => {
      cancelled = true
    }
  }, [
    activeWorkspaceId,
    preferenceRetryKey,
    userId,
    workspaceVersion,
  ])

  const loadSharingStatus =
    useCallback(
      async (isCurrent: () => boolean) => {
        if (!userId || !canConfigureWorkspace) {
          setDashboardSharingEnabled(false)
          setActiveSharingCount(0)
          setSharingStatusError("")
          setShareStatus("")
          return
        }

        try {
          const status =
            await loadWorkspaceSharingEnabled(
              userId,
              activeWorkspaceId
            )

          if (!isCurrent()) {
            return
          }

          setDashboardSharingEnabled(
            status.enabled
          )
          setActiveSharingCount(status.count)
          setSharingStatusError("")

          if (status.enabled) {
            setShareStatus("")
          }
        } catch (statusError) {
          if (!isCurrent()) {
            return
          }

          setSharingStatusError(
            statusError instanceof Error &&
              statusError.message
              ? statusError.message
              : "Dashboard sharing status is unavailable."
          )
        }
      },
      [
        activeWorkspaceId,
        canConfigureWorkspace,
        userId,
      ]
    )

  useEffect(() => {
    if (!userId) {
      return
    }

    let cancelled = false

    const initialLoadTimer =
      window.setTimeout(() => {
        void loadSharingStatus(
          () => !cancelled
        )
      }, 0)

    function handleSharingStatusRefresh() {
      if (
        document.visibilityState === "visible"
      ) {
        void loadSharingStatus(
          () => !cancelled
        )
      }
    }

    window.addEventListener(
      "focus",
      handleSharingStatusRefresh
    )
    window.addEventListener(
      "decisionate:dashboard-sharing-changed",
      handleSharingStatusRefresh
    )
    document.addEventListener(
      "visibilitychange",
      handleSharingStatusRefresh
    )

    return () => {
      window.removeEventListener(
        "focus",
        handleSharingStatusRefresh
      )
      window.removeEventListener(
        "decisionate:dashboard-sharing-changed",
        handleSharingStatusRefresh
      )
      document.removeEventListener(
        "visibilitychange",
        handleSharingStatusRefresh
      )
      window.clearTimeout(initialLoadTimer)
      cancelled = true
    }
  }, [
    loadSharingStatus,
    canConfigureWorkspace,
    userId,
    sharingStatusRetryKey,
    workspaceVersion,
  ])

  async function handleSelectDashboard(
    dashboardKey: string
  ) {
    if (!isDashboardKey(dashboardKey)) {
      return
    }

    if (dashboardKey === selectedDashboard) {
      router.push("/dashboard")
      return
    }

    if (!userId) {
      return
    }

    setSavingDashboard(dashboardKey)
    setError("")
    setPreferenceError("")

    try {
      const preference =
        await updateDashboardPreference(
          dashboardKey,
          userId,
          activeWorkspaceId
        )

      setSelectedDashboard(
        preference.selected_dashboard
      )
      router.push("/dashboard")
    } catch (preferenceError) {
      setError(
        preferenceError instanceof Error
          ? preferenceError.message
          : "Dashboard preference could not be saved."
      )
    } finally {
      setSavingDashboard("")
    }
  }

  async function handleStopAllSharing() {
    if (
      !userId ||
      !canConfigureWorkspace ||
      stoppingAllSharing
    ) {
      return
    }

    const confirmed =
      window.confirm(
        activeSharingCount > 0
          ? `Stop ${activeSharingCount} active dashboard share link${activeSharingCount === 1 ? "" : "s"} for this workspace? Existing links will no longer work.`
          : "Stop sharing for every dataset in this workspace? Existing dashboard share links will no longer work."
      )

    if (!confirmed) {
      return
    }

    setStoppingAllSharing(true)
    setError("")
    setShareStatus("")

    try {
      const result =
        await stopAllDatasetSharing(
          userId,
          activeWorkspaceId
        )

      setTemporaryShareStatus(
        result.datasets_updated === 0
          ? "No datasets are available to stop sharing."
          : result.shares_stopped
            ? `Stopped ${result.shares_stopped} shared dashboard link${result.shares_stopped === 1 ? "" : "s"} for this workspace.`
            : "No active dashboard share links were found."
      )
      setDashboardSharingEnabled(
        result.share_enabled
      )
      setActiveSharingCount(0)
      window.dispatchEvent(
        new CustomEvent(
          "decisionate:dashboard-sharing-changed",
          {
            detail: {
              scope: "workspace",
              action: "stop-all",
            },
          }
        )
      )
    } catch (stopError) {
      setError(
        stopError instanceof Error
          ? stopError.message
          : "Unable to stop all dashboard sharing."
      )
    } finally {
      setStoppingAllSharing(false)
    }
  }

  const stopAllSharingLabel =
    stoppingAllSharing
      ? "Stopping..."
      : activeSharingCount > 0
        ? `Stop all sharing (${activeSharingCount})`
        : "Stop all sharing"
  const stopAllSharingDescription =
    activeSharingCount > 0
      ? `Stop all sharing for ${activeSharingCount} active dashboard share link${activeSharingCount === 1 ? "" : "s"}.`
      : "Stop all dashboard sharing."

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Dashboards"
        description="Choose the professionally designed dashboard that becomes your main workspace view."
        actions={
          userId &&
          canConfigureWorkspace &&
          dashboardSharingEnabled &&
          activeSharingCount > 0 ? (
          <button
            type="button"
            onClick={handleStopAllSharing}
            disabled={stoppingAllSharing}
            title={stopAllSharingDescription}
            aria-label={stopAllSharingDescription}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 text-sm font-medium text-red-700 shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Unlink size={16} />
            {stopAllSharingLabel}
          </button>
          ) : undefined
        }
      />

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {preferenceError && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between"
        >
          <span>{preferenceError}</span>

          <button
            type="button"
            onClick={() =>
              setPreferenceRetryKey(
                currentKey => currentKey + 1
              )
            }
            className="w-fit rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-700 transition hover:bg-red-50"
          >
            Retry dashboard preference
          </button>
        </div>
      )}

      {canConfigureWorkspace && sharingStatusError && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between"
        >
          <span>{sharingStatusError}</span>

          <button
            type="button"
            onClick={() =>
              setSharingStatusRetryKey(
                currentKey => currentKey + 1
              )
            }
            className="w-fit rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-700 transition hover:bg-red-50"
          >
            Retry sharing status
          </button>
        </div>
      )}

      <WorkspaceAccessNotice
        loading={loadingWorkspaceAccess}
        canManageWorkspaceData={canConfigureWorkspace}
        message="Dashboard selection is personal to your shared workspace view. The business owner handles dashboard sharing."
        className="print:hidden"
      />

      {canConfigureWorkspace && shareStatus && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] px-3 py-2 text-sm text-[var(--decisionate-brand-primary-text)]"
        >
          {shareStatus}
        </div>
      )}

      <div className="space-y-5">
        {dashboardGroups.map(group => {
          return (
            <section
              key={group.category}
              className="space-y-2"
            >
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-600">
                  {group.category}
                </h2>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                  {group.dashboards.length}
                </span>
                <span className="h-px flex-1 bg-gray-200" />
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {group.dashboards.map(dashboard => (
                  <DashboardSelectionCard
                    key={dashboard.key}
                    dashboard={dashboard}
                    selected={
                      selectedDashboard ===
                      dashboard.key
                    }
                    saving={
                      savingDashboard ===
                      dashboard.key
                    }
                    disabled={
                      dashboardPreferenceLoading ||
                      Boolean(savingDashboard)
                    }
                    preferenceLoading={
                      dashboardPreferenceLoading
                    }
                    onSelect={handleSelectDashboard}
                  />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function DashboardSelectionCard({
  dashboard,
  selected,
  saving,
  disabled,
  preferenceLoading,
  onSelect,
}: {
  dashboard: DashboardDefinition
  selected: boolean
  saving: boolean
  disabled: boolean
  preferenceLoading: boolean
  onSelect: (dashboardKey: string) => void
}) {
  return (
    <div
      className={`rounded-2xl border bg-white p-3 shadow-sm ${
        selected
          ? "border-[var(--decisionate-brand-primary-ring)] ring-2 ring-[var(--decisionate-brand-primary-ring)]"
          : "border-gray-200"
      }`}
    >
      <DashboardPreview
        name={dashboard.name}
        tone={dashboard.previewTone}
        layout={dashboard.previewLayout}
        highlights={dashboard.highlights}
      />

      <div className="mt-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold">
            {dashboard.name}
          </h3>

          <p className="mt-1 min-h-10 text-xs leading-5 text-gray-500">
            {dashboard.description}
          </p>
        </div>

        {selected && (
          <span
            aria-label="Currently selected"
            className="rounded-full bg-[var(--decisionate-brand-primary-soft)] p-1.5 text-[var(--decisionate-brand-primary-text)]"
          >
            <Check size={14} aria-hidden="true" />
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-gray-500">
        {dashboard.dataBasis === "decision-records" ? (
          <ClipboardCheck size={13} aria-hidden="true" />
        ) : (
          <Database size={13} aria-hidden="true" />
        )}
        <span>
          {dashboard.dataBasis === "decision-records"
            ? "Uses decision records"
            : "Uses dataset metrics"}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {dashboard.highlights.map(highlight => (
          <div
            key={highlight}
        className="rounded-xl bg-gray-50 px-2 py-1 text-[11px] font-medium text-gray-600"
          >
            {highlight}
          </div>
        ))}
      </div>

      <button
        type="button"
        disabled={disabled}
        aria-pressed={selected}
        aria-label={`${selected ? "Open" : saving ? "Save and use" : "Use"} ${dashboard.name}`}
        onClick={() => onSelect(dashboard.key)}
        className={`mt-3 inline-flex h-10 w-full items-center justify-center rounded-xl text-sm font-medium transition ${
          selected
            ? "bg-gray-100 text-gray-700 hover:bg-gray-200"
            : "bg-[var(--decisionate-brand-primary)] text-white hover:bg-[var(--decisionate-brand-primary-hover)] disabled:cursor-not-allowed disabled:bg-[var(--decisionate-brand-primary-ring)]"
        }`}
      >
        {selected
          ? preferenceLoading
            ? "Loading..."
            : "Open Dashboard"
          : saving
            ? "Saving..."
            : preferenceLoading
              ? "Loading..."
              : "Use Dashboard"}
      </button>
    </div>
  )
}

function DashboardPreview({
  name,
  tone,
  layout,
  highlights,
}: {
  name: string
  tone: DashboardPreviewTone
  layout: "overview" | "funnel" | "decision"
  highlights: string[]
}) {
  const accentClass =
    tone === "green"
      ? "bg-green-500"
      : tone === "purple"
        ? "bg-purple-500"
        : tone === "orange"
          ? "bg-orange-500"
          : tone === "teal"
            ? "bg-teal-500"
            : tone === "amber"
              ? "bg-amber-500"
              : "bg-blue-500"
  const accentStrongClass =
    tone === "green"
      ? "bg-green-500"
      : tone === "purple"
        ? "bg-purple-500"
        : tone === "orange"
          ? "bg-orange-500"
          : tone === "teal"
            ? "bg-teal-500"
            : tone === "amber"
              ? "bg-amber-500"
              : "bg-blue-500"
  const accentMediumClass =
    tone === "green"
      ? "bg-green-400"
      : tone === "purple"
        ? "bg-purple-400"
        : tone === "orange"
          ? "bg-orange-400"
          : tone === "teal"
            ? "bg-teal-400"
            : tone === "amber"
              ? "bg-amber-400"
              : "bg-blue-400"
  const accentLightClass =
    tone === "green"
      ? "bg-green-300"
      : tone === "purple"
        ? "bg-purple-300"
        : tone === "orange"
          ? "bg-orange-300"
          : tone === "teal"
            ? "bg-teal-300"
            : tone === "amber"
              ? "bg-amber-300"
              : "bg-blue-300"
  const accentRingClass =
    tone === "green"
      ? "border-green-500"
      : tone === "purple"
        ? "border-purple-500"
        : tone === "orange"
          ? "border-orange-500"
          : tone === "teal"
            ? "border-teal-500"
            : tone === "amber"
              ? "border-amber-500"
              : "border-blue-500"
  const softClass =
    tone === "green"
      ? "bg-green-50"
      : tone === "purple"
        ? "bg-purple-50"
        : tone === "orange"
          ? "bg-orange-50"
          : tone === "teal"
            ? "bg-teal-50"
            : tone === "amber"
              ? "bg-amber-50"
              : "bg-blue-50"

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-950 shadow-sm">
      <div className="flex h-5 items-center gap-1 border-b border-white/10 bg-gray-900 px-2">
        <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
        <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
        <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
        <span className="ml-1 h-1.5 w-14 rounded-full bg-white/20" />
      </div>

      <div className="grid h-32 grid-cols-[2rem_minmax(0,1fr)] bg-white">
        <div className="space-y-1.5 border-r border-gray-100 bg-gray-50 p-1.5">
          <span className={`block h-4 rounded ${accentClass}`} />
          <span className="block h-1.5 rounded bg-gray-200" />
          <span className="block h-1.5 rounded bg-gray-200" />
          <span className="block h-1.5 rounded bg-gray-200" />
        </div>

        <div className="min-w-0 p-2">
          <div className="flex items-center justify-between">
            <div>
              <span className="block max-w-28 truncate text-[7px] font-semibold leading-none text-gray-700">
                {name}
              </span>
              <span className="mt-1 block h-1.5 w-12 rounded bg-gray-200" />
            </div>
            <LayoutDashboard
              size={12}
              className="text-gray-300"
            />
          </div>

          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {highlights.slice(0, 3).map((highlight, index) => (
              <div
                key={highlight}
                className={`min-w-0 rounded px-1 py-1 ${index === 1 ? "bg-gray-100" : softClass}`}
              >
                <span className="block truncate text-[6px] font-medium leading-none text-gray-500">
                  {highlight}
                </span>
                <span className={`mt-1 block h-1.5 rounded ${index === 1 ? "bg-gray-300" : accentMediumClass}`} />
              </div>
            ))}
          </div>

          {layout === "overview" && (
            <div className="mt-2 grid h-14 grid-cols-[minmax(0,1fr)_3.5rem] gap-1.5">
              <div className="flex items-end gap-1 rounded bg-gray-50 p-1.5">
                <span className={`h-5 flex-1 rounded ${accentLightClass}`} />
                <span className={`h-9 flex-1 rounded ${accentStrongClass}`} />
                <span className={`h-6 flex-1 rounded ${accentMediumClass}`} />
                <span className={`h-10 flex-1 rounded ${accentStrongClass}`} />
              </div>
              <div className="space-y-1 rounded bg-gray-50 p-1.5">
                <span className={`block h-2.5 rounded ${accentStrongClass}`} />
                <span className="block h-2 rounded bg-gray-200" />
                <span className="block h-2 rounded bg-gray-200" />
                <span className="block h-2 rounded bg-gray-200" />
              </div>
            </div>
          )}

          {layout === "funnel" && (
            <div className="mt-2 grid h-14 grid-cols-[minmax(0,1fr)_3.5rem] gap-1.5">
              <div className="space-y-1 rounded bg-gray-50 p-1.5">
                <span className={`block h-2.5 rounded ${accentStrongClass}`} />
                <span className={`mx-auto block h-2.5 w-4/5 rounded ${accentMediumClass}`} />
                <span className={`mx-auto block h-2.5 w-3/5 rounded ${accentLightClass}`} />
                <span className={`mx-auto block h-2.5 w-2/5 rounded ${accentLightClass}`} />
              </div>
              <div className="flex items-end gap-1 rounded bg-gray-50 p-1.5">
                <span className={`h-6 flex-1 rounded ${accentLightClass}`} />
                <span className={`h-10 flex-1 rounded ${accentStrongClass}`} />
                <span className={`h-4 flex-1 rounded ${accentLightClass}`} />
              </div>
            </div>
          )}

          {layout === "decision" && (
            <div className="mt-2 grid h-14 grid-cols-[3.5rem_minmax(0,1fr)] gap-1.5">
              <div className={`flex items-center justify-center rounded ${softClass}`}>
                <span className={`flex h-10 w-10 items-center justify-center rounded-full border-8 ${accentRingClass}`}>
                  <span className="h-4 w-4 rounded-full bg-white" />
                </span>
              </div>
              <div className="space-y-1 rounded bg-gray-50 p-1.5">
                <span className={`block h-2 rounded ${accentClass}`} />
                <span className="block h-2 w-4/5 rounded bg-gray-200" />
                <span className="block h-2 w-3/5 rounded bg-gray-200" />
                <span className="mt-1.5 block h-4 rounded bg-gray-200" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
