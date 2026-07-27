"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { UserButton, useUser } from "@clerk/nextjs"
import {
  AlertCircle,
  BarChart3,
  Bell,
  Database,
  FileText,
  Home,
  LayoutDashboard,
  LineChart,
  Plug,
  Settings,
  Target,
} from "lucide-react"
import {
  useEffect,
  useState,
  type ReactNode,
} from "react"

import {
  getMyOrganization,
  getOrganizationWorkspaces,
  getApiAvailabilitySnapshot,
  apiAvailabilityChangedEvent,
  type ApiAvailabilityEventDetail,
  type OrganizationRecord,
  type OrganizationWorkspaceRecord,
} from "@/lib/api"
import {
  getActiveWorkspaceId,
  setActiveWorkspaceId,
} from "@/lib/workspace-context"
import {
  useActiveWorkspace,
} from "@/lib/use-active-workspace"
import {
  useWorkspaceBrowserBrand,
} from "@/lib/use-workspace-browser-brand"

type DashboardShellProps = {
  children: ReactNode
}

type DashboardNavItem = {
  href: string
  label: string
  icon: ReactNode
  ownerOnly?: boolean
}

type DashboardNavGroup = {
  label: string
  items: DashboardNavItem[]
}

type OrganizationUpdatedEvent =
  CustomEvent<OrganizationRecord>

const dashboardNavGroups: DashboardNavGroup[] = [
  {
    label: "Workspace",
    items: [
      {
        href: "/dashboard",
        label: "Dashboard",
        icon: <Home size={18} />,
      },
      {
        href: "/dashboard/dashboards",
        label: "Dashboards",
        icon: <LayoutDashboard size={18} />,
      },
      {
        href: "/dashboard/decisions",
        label: "Decisions",
        icon: <Target size={18} />,
      },
      {
        href: "/dashboard/action-needed",
        label: "Action Needed",
        icon: <AlertCircle size={18} />,
      },
    ],
  },
  {
    label: "Analysis",
    items: [
      {
        href: "/dashboard/insights",
        label: "Insights",
        icon: <BarChart3 size={18} />,
      },
      {
        href: "/dashboard/forecasts",
        label: "Forecasts",
        icon: <LineChart size={18} />,
      },
      {
        href: "/dashboard/reports",
        label: "Reports",
        icon: <FileText size={18} />,
      },
    ],
  },
  {
    label: "Data",
    items: [
      {
        href: "/dashboard/datasets",
        label: "Datasets",
        icon: <Database size={18} />,
      },
      {
        href: "/dashboard/connections",
        label: "Connections",
        icon: <Plug size={18} />,
        ownerOnly: true,
      },
    ],
  },
  {
    label: "Manage",
    items: [
      {
        href: "/dashboard/alerts",
        label: "Alerts",
        icon: <Bell size={18} />,
        ownerOnly: true,
      },
      {
        href: "/dashboard/settings",
        label: "Settings",
        icon: <Settings size={18} />,
        ownerOnly: true,
      },
    ],
  },
]

/* =========================
   Dashboard Shell With Workspace Context And Active Navigation
========================= */

export function DashboardShell({
  children,
}: DashboardShellProps) {
  const pathname = usePathname()
  const { user } = useUser()
  const [organization, setOrganization] =
    useState<OrganizationRecord | null>(null)
  const [workspaces, setWorkspaces] =
    useState<OrganizationWorkspaceRecord[]>([])
  const [apiUnavailableMessage, setApiUnavailableMessage] =
    useState(() => {
      const initialDetail =
        getApiAvailabilitySnapshot()

      return initialDetail && !initialDetail.available
        ? initialDetail.message ||
            "The API service is unavailable."
        : ""
    })
  const { activeWorkspaceId } =
    useActiveWorkspace(user?.id)

  useEffect(() => {
    if (!user?.id) return

    let ignoreResult = false

    async function loadOrganization(
      userId: string
    ) {
      try {
        const [
          organizationData,
          workspaceData,
        ] = await Promise.all([
          getMyOrganization(
            userId
          ),
          getOrganizationWorkspaces(
            userId
          ),
        ])

        if (!ignoreResult) {
          setOrganization(organizationData)
          setWorkspaces(workspaceData)

          const storedWorkspaceId =
            getActiveWorkspaceId(
              userId
            )
          const sharedWorkspaces =
            workspaceData.filter(
              (workspace) =>
                workspace.owner_user_id !== userId
            )
          const defaultWorkspaceId =
            organizationData ||
            sharedWorkspaces.length === 0
              ? userId
              : sharedWorkspaces[0].owner_user_id
          const workspaceAvailable =
            (
              storedWorkspaceId === userId &&
              Boolean(organizationData)
            ) ||
            workspaceData.some(
              (workspace) =>
                workspace.owner_user_id === storedWorkspaceId
            )
          const nextWorkspaceId =
            workspaceAvailable
              ? storedWorkspaceId
              : defaultWorkspaceId

          if (nextWorkspaceId !== storedWorkspaceId) {
            setActiveWorkspaceId(
              userId,
              nextWorkspaceId
            )
          }

        }
      } catch (error) {
        console.error(error)
      }
    }

    void loadOrganization(
      user.id
    )

    return () => {
      ignoreResult = true
    }
  }, [user?.id])

  useEffect(() => {
    function handleApiAvailabilityChanged(
      event: Event
    ) {
      const detail = (
        event as CustomEvent<ApiAvailabilityEventDetail>
      ).detail

      if (detail?.available) {
        setApiUnavailableMessage("")
        return
      }

      setApiUnavailableMessage(
        detail?.message ||
          "The API service is unavailable."
      )
    }

    window.addEventListener(
      apiAvailabilityChangedEvent,
      handleApiAvailabilityChanged
    )

    return () => {
      window.removeEventListener(
        apiAvailabilityChangedEvent,
        handleApiAvailabilityChanged
      )
    }
  }, [])

  useEffect(() => {
    function handleOrganizationUpdated(
      event: Event
    ) {
      const organizationEvent =
        event as OrganizationUpdatedEvent

      setOrganization(
        organizationEvent.detail
      )
    }

    window.addEventListener(
      "decisionate:organization-updated",
      handleOrganizationUpdated
    )

    return () => {
      window.removeEventListener(
        "decisionate:organization-updated",
        handleOrganizationUpdated
      )
    }
  }, [])

  const workspaceName =
    getWorkspaceDisplayName(
      activeWorkspaceId,
      user?.id,
      organization,
      workspaces,
      user?.fullName
    ) ??
    user?.fullName ??
    "Decisionate Workspace"
  const activeBrand =
    getWorkspaceBrand(
      activeWorkspaceId,
      user?.id,
      organization,
      workspaces,
      user?.fullName
    )

  useWorkspaceBrowserBrand(
    undefined,
    activeBrand,
  )
  const activeSharedWorkspace =
    getActiveSharedWorkspace(
      activeWorkspaceId,
      user?.id,
      workspaces
    )

  const workspaceOptions =
    getWorkspaceOptions(
      user?.id,
      organization,
      workspaces,
      user?.fullName
    )
  const activeWorkspaceRecord =
    workspaces.find(
      workspace =>
        workspace.owner_user_id ===
        activeWorkspaceId
    )
  const canConfigureWorkspace =
    Boolean(user?.id) &&
    (!activeWorkspaceId ||
      activeWorkspaceId === user?.id ||
      activeWorkspaceRecord?.role?.toLowerCase() ===
        "owner")

  function handleWorkspaceChange(
    nextWorkspaceId: string
  ) {
    if (!user?.id) return

    setActiveWorkspaceId(
      user.id,
      nextWorkspaceId
    )
  }

  return (
    <div className="dashboard-shell-layout flex h-screen overflow-hidden bg-gray-50">
      {apiUnavailableMessage && (
        <div
          role="alert"
          aria-live="assertive"
          className="dashboard-print-hidden fixed inset-x-4 top-4 z-50 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-lg md:left-auto md:max-w-xl"
        >
          <span className="min-w-0 break-words">
            {apiUnavailableMessage}
          </span>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100"
            >
              Reload
            </button>
            <button
              type="button"
              onClick={() => setApiUnavailableMessage("")}
              className="rounded-lg px-2 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {/* =========================
          Dashboard Sidebar Brand Workspace And Primary Navigation
      ========================= */}

      <aside className="dashboard-print-hidden flex h-screen w-64 shrink-0 flex-col border-r bg-white">
        <div className="shrink-0 border-b p-6">
          <div className="flex items-center gap-3">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl text-sm font-bold text-white"
              style={{
                backgroundColor:
                  activeBrand.primaryColor,
              }}
            >
              {activeBrand.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={activeBrand.logoUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                activeBrand.name
                  .charAt(0)
                  .toUpperCase()
              )}
            </div>

            <div className="min-w-0">
              <h1
                className="truncate text-xl font-bold"
                style={{
                  color: activeBrand.primaryColor,
                }}
              >
                {activeBrand.name}
              </h1>

              <p className="truncate text-xs text-gray-400">
                {activeSharedWorkspace
                  ? `${formatWorkspaceRole(
                    activeSharedWorkspace.role
                  )} portal`
                  : organization
                    ? "Agency workspace"
                    : "Workspace"}
              </p>
            </div>
          </div>

          <p className="mt-1 truncate text-sm text-gray-500">
            {workspaceName}
          </p>

          {workspaceOptions.length > 1 && (
            <select
              value={activeWorkspaceId || user?.id || ""}
              onChange={(event) =>
                handleWorkspaceChange(
                  event.target.value
                )
              }
              className="mt-4 h-9 w-full rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            >
              {workspaceOptions.map((workspace) => (
                <option
                  key={workspace.id}
                  value={workspace.id}
                >
                  {workspace.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="space-y-5">
            {dashboardNavGroups.map((group) => {
              const visibleItems =
                group.items.filter(
                  item =>
                    !item.ownerOnly ||
                    canConfigureWorkspace
                )

              if (visibleItems.length === 0) {
                return null
              }

              return (
              <div key={group.label}>
                <p className="mb-2 px-4 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  {group.label}
                </p>

                <div className="space-y-1">
                  {visibleItems.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={getNavLinkClass(
                        isActiveDashboardPath(
                          pathname,
                          item.href
                        )
                      )}
                    >
                      {item.icon}
                      {item.label}
                    </Link>
                  ))}
                </div>
              </div>
              )
            })}
          </div>
        </nav>

        {/* =========================
            Dashboard Account Footer With Clerk User Controls
        ========================= */}

        <div className="shrink-0 border-t p-4">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-800">
                {user?.fullName ?? "Account"}
              </p>

              <p className="truncate text-xs text-gray-500">
                {user?.primaryEmailAddress?.emailAddress ?? ""}
              </p>
            </div>

            <div className="shrink-0">
              <UserButton />
            </div>
          </div>
        </div>
      </aside>

      {/* =========================
          Dashboard Main Content Area For Nested Product Pages
      ========================= */}

      <main className="dashboard-print-main h-screen flex-1 overflow-y-auto p-8">
        {children}
      </main>
    </div>
  )
}

/* =========================
   Dashboard Workspace Selector Helpers For Personal And Shared Organizations
========================= */

function getWorkspaceOptions(
  userId: string | undefined,
  organization: OrganizationRecord | null,
  workspaces: OrganizationWorkspaceRecord[],
  fullName: string | null | undefined
) {
  if (!userId) {
    return []
  }

  const sharedWorkspaces =
    workspaces
      .filter(
        (workspace) =>
          workspace.owner_user_id !== userId
      )
      .map((workspace) => ({
        id: workspace.owner_user_id,
        name: `${formatWorkspaceRole(
          workspace.role
        )}: ${workspace.name}`,
      }))

  if (
    !organization &&
    sharedWorkspaces.length > 0
  ) {
    return sharedWorkspaces
  }

  const personalWorkspace = {
    id: userId,
    name: `Personal: ${
      organization?.name ??
      fullName ??
      "My Workspace"
    }`,
  }

  return [
    personalWorkspace,
    ...sharedWorkspaces,
  ]
}

function getWorkspaceDisplayName(
  activeWorkspaceId: string,
  userId: string | undefined,
  organization: OrganizationRecord | null,
  workspaces: OrganizationWorkspaceRecord[],
  fullName: string | null | undefined
) {
  if (!userId || !activeWorkspaceId || activeWorkspaceId === userId) {
    return organization?.name ?? fullName
  }

  return (
    workspaces.find(
      (workspace) =>
        workspace.owner_user_id === activeWorkspaceId
    )?.name ?? fullName
  )
}

function getWorkspaceBrand(
  activeWorkspaceId: string,
  userId: string | undefined,
  organization: OrganizationRecord | null,
  workspaces: OrganizationWorkspaceRecord[],
  fullName: string | null | undefined
) {
  const fallbackName =
    organization?.report_display_name ||
    organization?.name ||
    fullName ||
    "Decisionate"

  if (!userId || !activeWorkspaceId || activeWorkspaceId === userId) {
    return {
      name: fallbackName,
      logoUrl: organization?.logo_url ?? "",
      primaryColor:
        organization?.primary_color ?? "#2563EB",
      accentColor:
        organization?.accent_color ?? "#14B8A6",
    }
  }

  const workspace =
    workspaces.find(
      (item) =>
        item.owner_user_id === activeWorkspaceId
    )

  return {
    name:
      workspace?.report_display_name ||
      workspace?.name ||
      fallbackName,
    logoUrl: workspace?.logo_url ?? "",
    primaryColor:
      workspace?.primary_color ?? "#2563EB",
    accentColor:
      workspace?.accent_color ?? "#14B8A6",
  }
}

function getActiveSharedWorkspace(
  activeWorkspaceId: string,
  userId: string | undefined,
  workspaces: OrganizationWorkspaceRecord[]
) {
  if (
    !userId ||
    !activeWorkspaceId ||
    activeWorkspaceId === userId
  ) {
    return null
  }

  return workspaces.find(
    (workspace) =>
      workspace.owner_user_id === activeWorkspaceId
  ) ?? null
}

function formatWorkspaceRole(
  role: string
) {
  return role
    .replaceAll("_", " ")
    .replace(
      /\b\w/g,
      (character) => character.toUpperCase()
    )
}

function isActiveDashboardPath(
  pathname: string,
  href: string
) {
  if (href === "/dashboard") {
    return pathname === href
  }

  return pathname === href ||
    pathname.startsWith(`${href}/`)
}

function getNavLinkClass(
  active: boolean
) {
  return `flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition ${
    active
      ? "bg-blue-50 text-blue-700"
      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
  }`
}
