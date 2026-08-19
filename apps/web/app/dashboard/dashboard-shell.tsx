"use client"

import Link from "next/link"
import {
  usePathname,
  useRouter,
} from "next/navigation"
import { UserButton, useUser } from "@clerk/nextjs"
import {
  AlertCircle,
  BarChart3,
  Bell,
  CreditCard,
  Database,
  ChevronDown,
  ChevronRight,
  FileText,
  GitCompare,
  Home,
  LayoutDashboard,
  LineChart,
  LifeBuoy,
  Plug,
  Settings,
  Target,
} from "lucide-react"
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"

import {
  getMyOrganization,
  getOrganizationWorkspaces,
  getApiAvailabilitySnapshot,
  apiAvailabilityChangedEvent,
  getBillingAccessStatus,
  type ApiAvailabilityEventDetail,
  type BillingAccessStatus,
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
import {
  getWorkspaceBrand,
} from "@/lib/workspace-brand"

type DashboardShellProps = {
  children: ReactNode
}

type DashboardNavItem = {
  href: string
  label: string
  icon: ReactNode
  ownerOnly?: boolean
  roles?: Array<"owner" | "member" | "client" | "managed_client">
}

type DashboardNavGroup = {
  label: string
  items: DashboardNavItem[]
  collapsible?: boolean
  roles?: Array<"owner" | "member" | "client" | "managed_client">
}

type OrganizationUpdatedEvent =
  CustomEvent<OrganizationRecord>

const subscribeToClientMount = () => () => {}
const getClientMountSnapshot = () => true
const getServerMountSnapshot = () => false

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
      {
        href: "/dashboard/settings",
        label: "Workspace Access",
        icon: <Settings size={18} />,
        roles: ["client"],
      },
    ],
  },
  {
    label: "Analysis",
    collapsible: true,
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
      {
        href: "/dashboard/alerts",
        label: "Alerts",
        icon: <Bell size={18} />,
        roles: ["owner", "client", "managed_client"],
      },
      {
        href: "/dashboard/relationships",
        label: "Relationships",
        icon: <GitCompare size={18} />,
      },
    ],
  },
  {
    label: "Data",
    collapsible: true,
    roles: ["owner", "client"],
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
        roles: ["owner", "client"],
      },
    ],
  },
  {
    label: "Manage",
    collapsible: true,
    roles: ["owner"],
    items: [
      {
        href: "/dashboard/settings",
        label: "Settings",
        icon: <Settings size={18} />,
        ownerOnly: true,
        roles: ["owner"],
      },
      {
        href: "/dashboard/billing",
        label: "Billing",
        icon: <CreditCard size={18} />,
        ownerOnly: true,
        roles: ["owner"],
      },
    ],
  },
  {
    label: "Support",
    items: [
      {
        href: "/dashboard/help",
        label: "Help & Support",
        icon: <LifeBuoy size={18} />,
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
  const router = useRouter()
  const { user } = useUser()
  const [organization, setOrganization] =
    useState<OrganizationRecord | null>(null)
  const [workspaces, setWorkspaces] =
    useState<OrganizationWorkspaceRecord[]>([])
  const [workspaceAccessUserId, setWorkspaceAccessUserId] =
    useState("")
  const [workspaceSetupUserId, setWorkspaceSetupUserId] =
    useState("")
  const [expandedNavGroups, setExpandedNavGroups] =
    useState<Record<string, boolean>>({})
  const [apiUnavailableMessage, setApiUnavailableMessage] =
    useState(() => {
      const initialDetail =
        getApiAvailabilitySnapshot()

      return initialDetail && !initialDetail.available
        ? initialDetail.message ||
            "The API service is unavailable."
        : ""
    })
  const [subscriptionAccess, setSubscriptionAccess] =
    useState<BillingAccessStatus | null>(null)
  const [subscriptionAccessKey, setSubscriptionAccessKey] =
    useState("")
  const { activeWorkspaceId } =
    useActiveWorkspace(user?.id)
  const clerkButtonMounted = useSyncExternalStore(
    subscribeToClientMount,
    getClientMountSnapshot,
    getServerMountSnapshot
  )

  const activeCollapsibleGroupLabel =
    dashboardNavGroups.find(
      group =>
        group.collapsible &&
        group.items.some(item =>
          isActiveDashboardPath(pathname, item.href)
        )
    )?.label

  useEffect(() => {
    if (
      !user?.id ||
      pathname === "/dashboard/billing"
    ) {
      return
    }

    let ignoreResult = false

    async function loadOrganization(
      userId: string
    ) {
      try {
        const [
          organizationResult,
          workspaceResult,
        ] = await Promise.allSettled([
          getMyOrganization(
            userId
          ),
          getOrganizationWorkspaces(
            userId,
            user?.primaryEmailAddress?.emailAddress,
            {
              includeManagedClientWorkspaces: true,
            }
          ),
        ])

        if (
          organizationResult.status === "rejected" &&
          workspaceResult.status === "rejected"
        ) {
          throw organizationResult.reason
        }

        const organizationData =
          organizationResult.status === "fulfilled"
            ? organizationResult.value
            : null
        const workspaceData =
          workspaceResult.status === "fulfilled"
            ? workspaceResult.value
            : []
        const selectableWorkspaces =
          workspaceData.filter(
            workspace =>
              workspace.role.toLowerCase() !==
                "managed_client" ||
              workspace.agency_owner_access_enabled === true
          )

        if (!ignoreResult) {
          setOrganization(organizationData)
          setWorkspaces(selectableWorkspaces)
          setWorkspaceAccessUserId(userId)
          if (
            organizationResult.status === "fulfilled" &&
            workspaceResult.status === "fulfilled"
          ) {
            setWorkspaceSetupUserId(userId)
          }

          const storedWorkspaceId =
            getActiveWorkspaceId(
              userId
            )
          const sharedWorkspaces =
            selectableWorkspaces.filter(
              (workspace) =>
                workspace.owner_user_id !== userId
            )
          const clientWorkspaces =
            sharedWorkspaces.filter(
              (workspace) =>
                workspace.role.toLowerCase() ===
                "client"
            )
          let defaultWorkspaceId = userId

          if (clientWorkspaces.length > 0) {
            defaultWorkspaceId =
              clientWorkspaces[0].owner_user_id
          } else if (
            !organizationData &&
            sharedWorkspaces.length > 0
          ) {
            defaultWorkspaceId =
              sharedWorkspaces[0].owner_user_id
          }
          const workspaceAvailable =
            (
              storedWorkspaceId === userId &&
              Boolean(organizationData)
            ) ||
            selectableWorkspaces.some(
              (workspace) =>
                workspace.owner_user_id === storedWorkspaceId
            )
          const nextWorkspaceId =
            clientWorkspaces.length > 0 &&
            storedWorkspaceId === userId
              ? defaultWorkspaceId
              : workspaceAvailable
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
  }, [
    pathname,
    user?.id,
    user?.primaryEmailAddress?.emailAddress,
  ])

  useEffect(() => {
    if (
      !user?.id ||
      pathname === "/dashboard/billing" ||
      pathname === "/dashboard/help"
    ) {
      return
    }

    let ignoreResult = false
    const userId = user.id

    async function loadSubscriptionAccess() {
      try {
        const access = await getBillingAccessStatus(
          userId,
          activeWorkspaceId,
        )
        if (!ignoreResult) {
          setSubscriptionAccess(access)
          setSubscriptionAccessKey(
            `${userId}:${activeWorkspaceId || ""}`
          )
        }
      } catch {
        if (!ignoreResult) {
          setSubscriptionAccess(null)
        }
      }
    }

    void loadSubscriptionAccess()

    return () => {
      ignoreResult = true
    }
  }, [
    activeWorkspaceId,
    pathname,
    user?.id,
  ])

  useEffect(() => {
    if (
      !user?.id ||
      pathname === "/onboarding" ||
      workspaceSetupUserId !== user.id ||
      workspaceAccessUserId !== user.id ||
      organization ||
      workspaces.length > 0
    ) {
      return
    }

    router.replace("/onboarding")
  }, [
    organization,
    pathname,
    router,
    user?.id,
    workspaceAccessUserId,
    workspaceSetupUserId,
    workspaces.length,
  ])

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

  const workspaceDataBelongsToUser =
    Boolean(user?.id) &&
    workspaceAccessUserId === user?.id
  const visibleOrganization =
    workspaceDataBelongsToUser
      ? organization
      : null
  const visibleWorkspaces =
    workspaceDataBelongsToUser
      ? workspaces
      : []
  const workspaceName =
    getWorkspaceDisplayName(
      activeWorkspaceId,
      user?.id,
      visibleOrganization,
      visibleWorkspaces,
      user?.fullName
    ) ??
    user?.fullName ??
    "Decisionate Workspace"
  const activeBrand =
    getWorkspaceBrand(
      activeWorkspaceId,
      user?.id,
      visibleOrganization,
      visibleWorkspaces,
      user?.fullName
    )
  const activeBrandReady =
    Boolean(
      user?.id &&
      activeWorkspaceId &&
      (
        activeWorkspaceId === user.id
          ? visibleOrganization !== null
          : visibleWorkspaces.some(
              workspace =>
                workspace.owner_user_id === activeWorkspaceId
            )
      )
    )
  const displayBrand =
    activeBrandReady
      ? activeBrand
      : {
          name: "Loading workspace",
          logoUrl: "",
          primaryColor: "#CBD5E1",
          accentColor: "#E2E8F0",
        }
  const displayWorkspaceName =
    activeBrandReady
      ? workspaceName
      : "Loading workspace..."

  useWorkspaceBrowserBrand(
    activeBrand.name,
    activeBrand,
    {
      keepFaviconStable: true,
      workspaceKey: `${user?.id || ""}:${activeWorkspaceId || ""}`,
      brandReady: activeBrandReady,
    }
  )
  const activeSharedWorkspace =
    getActiveSharedWorkspace(
      activeWorkspaceId,
      user?.id,
      visibleWorkspaces
    )

  const workspaceOptions =
    getWorkspaceOptions(
      user?.id,
      activeWorkspaceId,
      visibleOrganization,
      visibleWorkspaces,
      user?.fullName
    )
  const activeWorkspaceRecord =
    visibleWorkspaces.find(
      workspace =>
        workspace.owner_user_id ===
        activeWorkspaceId
    )
  const isCurrentUserOwnerWorkspace =
    activeWorkspaceId === user?.id &&
    visibleOrganization !== null
  const activeWorkspaceRole =
    !user?.id ||
    !activeWorkspaceId
      ? "unknown"
      : activeWorkspaceId === user.id
        ? isCurrentUserOwnerWorkspace
          ? "owner"
          : activeWorkspaceRecord?.role?.toLowerCase() ??
            "unknown"
        : activeWorkspaceRecord?.role?.toLowerCase() ??
          "unknown"
  const isClientWorkspaceContext =
    Boolean(
      activeWorkspaceRecord?.owner_user_id.includes(":client:") ||
      activeWorkspaceId.includes(":client:")
    )
  const isBusinessOwnerWorkspace =
    activeWorkspaceRole === "owner" &&
    !isClientWorkspaceContext &&
    (
      Boolean(activeWorkspaceRecord) ||
      (
        activeWorkspaceId === user?.id &&
        visibleOrganization !== null
      )
    )
  const hasOwnerWorkspaceMembership =
    workspaceAccessUserId === user?.id &&
    isBusinessOwnerWorkspace
  const isOrganizationOwner =
    workspaceAccessUserId === user?.id &&
    isBusinessOwnerWorkspace
  const canConfigureWorkspace =
    isBusinessOwnerWorkspace &&
    hasOwnerWorkspaceMembership &&
    isOrganizationOwner
  const canSwitchWorkspaces =
    activeWorkspaceRole === "owner" ||
    activeWorkspaceRole === "managed_client"

  const subscriptionAccessBlocked =
    Boolean(
      pathname !== "/dashboard/billing" &&
      pathname !== "/dashboard/help" &&
      subscriptionAccessKey ===
        `${user?.id || ""}:${activeWorkspaceId || ""}` &&
      subscriptionAccess &&
      !subscriptionAccess.access_allowed
    )

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
                  displayBrand.primaryColor,
              }}
            >
              {displayBrand.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={displayBrand.logoUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                displayBrand.name
                  .charAt(0)
                  .toUpperCase()
              )}
            </div>

            <div className="min-w-0">
              <h1
                className="truncate text-xl font-bold"
                style={{
                  color: displayBrand.primaryColor,
                }}
              >
                {displayBrand.name}
              </h1>

              <p className="truncate text-xs text-gray-400">
                {activeSharedWorkspace
                  ? `${formatWorkspaceRole(
                    activeSharedWorkspace.role
                  )} portal`
                  : visibleOrganization
                    ? "Business workspace"
                    : "Workspace"}
              </p>
            </div>
          </div>

          <p className="mt-1 truncate text-sm text-gray-500">
            {displayWorkspaceName}
          </p>

          {canSwitchWorkspaces && workspaceOptions.length > 1 && (
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
              const groupRoleVisible =
                !group.roles ||
                group.roles.includes(
                  activeWorkspaceRole as
                    | "owner"
                    | "member"
                    | "client"
                    | "managed_client"
                )
              const agencyManageGroupVisible =
                group.label !== "Manage" ||
                (
                  activeWorkspaceRole === "owner" &&
                  isBusinessOwnerWorkspace &&
                  canConfigureWorkspace &&
                  !isClientWorkspaceContext
                )

              if (
                !groupRoleVisible ||
                !agencyManageGroupVisible
              ) {
                return null
              }

              const visibleItems =
                group.items.filter(
                  item =>
                    !item.ownerOnly ||
                    canConfigureWorkspace
                ).filter(
                  item =>
                    !item.roles ||
                    item.roles.includes(
                      activeWorkspaceRole as
                        | "owner"
                        | "member"
                        | "client"
                        | "managed_client"
                    )
                )

              if (visibleItems.length === 0) {
                return null
              }

              const isExpanded =
                !group.collapsible ||
                (
                  expandedNavGroups[group.label] ??
                  group.label === activeCollapsibleGroupLabel
                )

              return (
                <div key={group.label}>
                  {group.collapsible ? (
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      aria-controls={`dashboard-nav-${group.label.toLowerCase()}`}
                      onClick={() =>
                        setExpandedNavGroups(() => {
                          const nextExpandedNavGroups: Record<
                            string,
                            boolean
                          > = {}

                          dashboardNavGroups.forEach(navGroup => {
                            if (navGroup.collapsible) {
                              nextExpandedNavGroups[navGroup.label] =
                                false
                            }
                          })

                          nextExpandedNavGroups[group.label] =
                            !isExpanded

                          return nextExpandedNavGroups
                        })
                      }
                      className="flex w-full items-center justify-between rounded-lg px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                    >
                      <span>{group.label}</span>
                      {isExpanded ? (
                        <ChevronDown size={15} aria-hidden="true" />
                      ) : (
                        <ChevronRight size={15} aria-hidden="true" />
                      )}
                    </button>
                  ) : (
                    <p className="mb-2 px-4 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                      {group.label}
                    </p>
                  )}

                  {isExpanded && (
                    <div
                      id={`dashboard-nav-${group.label.toLowerCase()}`}
                      className="space-y-1"
                    >
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
                  )}
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
              {clerkButtonMounted ? (
                <UserButton />
              ) : (
                <div
                  aria-hidden="true"
                  className="h-8 w-8 rounded-full bg-gray-200"
                />
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* =========================
          Dashboard Main Content Area For Nested Product Pages
      ========================= */}

      <main className="dashboard-print-main h-screen flex-1 overflow-y-auto p-8">
        {subscriptionAccessBlocked && subscriptionAccess ? (
          <SubscriptionRequiredPanel
            access={subscriptionAccess}
            canManageBilling={canConfigureWorkspace}
          />
        ) : (
          children
        )}
      </main>
    </div>
  )
}

function SubscriptionRequiredPanel({
  access,
  canManageBilling,
}: {
  access: BillingAccessStatus
  canManageBilling: boolean
}) {
  const title =
    access.status === "grace_period"
      ? "Payment needs attention"
      : "Subscription required"
  const description =
    access.status === "grace_period"
      ? "Your workspace remains available during the billing grace period, but billing details must be updated to keep access."
      : access.reason || "Renew your plan to continue using this workspace."

  return (
    <section className="mx-auto mt-8 max-w-2xl rounded-2xl border border-amber-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-amber-100 p-2 text-amber-700">
          <CreditCard size={20} aria-hidden="true" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">
            Billing action required
          </p>
          <h2 className="mt-1 text-xl font-semibold text-gray-900">
            {title}
          </h2>
          <p className="mt-3 text-sm leading-6 text-gray-600">
            {description}
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {canManageBilling ? (
          <Link
            href="/dashboard/billing"
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--decisionate-brand-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            <CreditCard size={16} aria-hidden="true" />
            Open billing
          </Link>
        ) : (
          <p className="text-sm font-medium text-gray-700">
            Ask the workspace owner to update billing.
          </p>
        )}
        <Link
          href="/dashboard/help"
          className="text-sm font-medium text-gray-600 underline underline-offset-4 hover:text-gray-900"
        >
          Contact support
        </Link>
      </div>
    </section>
  )
}

/* =========================
   Dashboard Workspace Selector Helpers For Personal And Shared Organizations
========================= */

function getWorkspaceOptions(
  userId: string | undefined,
  activeWorkspaceId: string,
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

  // A client portal is backed by its agency-managed workspace. The personal
  // option is only a local fallback for users who own an organization.
  const activeWorkspace =
    workspaces.find(
      workspace =>
        workspace.owner_user_id === activeWorkspaceId
    )
  const isClientPortalWorkspace =
    activeWorkspace?.role.toLowerCase() === "client"

  if (isClientPortalWorkspace) {
    return sharedWorkspaces
  }

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
