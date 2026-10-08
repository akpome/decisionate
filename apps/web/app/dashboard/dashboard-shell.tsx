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
  Menu,
  Plug,
  RefreshCw,
  Settings,
  Target,
  UsersRound,
  X,
  Wrench,
} from "lucide-react"
import {
  useEffect,
  useRef,
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
  getActiveMaintenanceNotice,
  type ApiAvailabilityEventDetail,
  type BillingAccessStatus,
  type MaintenanceNotice,
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
import { ThemeToggle } from "@/app/theme-toggle"
import {
  decisionateLanguageChangedEvent,
  getCurrentDecisionateLanguage,
  getDecisionateText,
  getServerDecisionateLanguage,
  type DecisionateLanguage,
  type DecisionateTranslationKey,
} from "@/lib/language"

type DashboardShellProps = {
  children: ReactNode
}

type DashboardNavItem = {
  href: string
  label: string
  icon: ReactNode
  ownerOnly?: boolean
  roles?: Array<"owner" | "member" | "client" | "client_owner" | "client_user" | "managed_client">
}

type DashboardNavGroup = {
  label: string
  items: DashboardNavItem[]
  collapsible?: boolean
  roles?: Array<"owner" | "member" | "client" | "client_owner" | "client_user" | "managed_client">
}

type OrganizationUpdatedEvent =
  CustomEvent<OrganizationRecord>

const subscribeToClientMount = () => () => {}
const getClientMountSnapshot = () => true
const getServerMountSnapshot = () => false
const mobileNavigationQuery = "(max-width: 1279px)"
const getMobileNavigationSnapshot = () => window.matchMedia(mobileNavigationQuery).matches
const getServerMobileNavigationSnapshot = () => true

function subscribeToMobileNavigation(onChange: () => void) {
  const media = window.matchMedia(mobileNavigationQuery)
  media.addEventListener("change", onChange)
  return () => media.removeEventListener("change", onChange)
}

function subscribeToDecisionateLanguage(
  onLanguageChange: () => void
) {
  if (typeof window === "undefined") {
    return () => {}
  }

  window.addEventListener(
    decisionateLanguageChangedEvent,
    onLanguageChange
  )

  return () => {
    window.removeEventListener(
      decisionateLanguageChangedEvent,
      onLanguageChange
    )
  }
}

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
        roles: ["client", "client_owner", "client_user"],
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
        roles: ["owner", "client", "client_owner", "client_user", "managed_client"],
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
    roles: ["owner", "client", "client_owner", "client_user"],
    items: [
      {
        href: "/dashboard/datasets",
        label: "Datasets",
        icon: <Database size={18} />,
      },
      {
        href: "/dashboard/entity-matching",
        label: "Entity Matching",
        icon: <UsersRound size={18} />,
      },
      {
        href: "/dashboard/connections",
        label: "Connections",
        icon: <Plug size={18} />,
        roles: ["owner", "client", "client_owner", "client_user"],
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

const dashboardNavigationTranslationKeys: Record<
  string,
  DecisionateTranslationKey
> = {
  Workspace: "workspace",
  Dashboard: "dashboard",
  Dashboards: "dashboards",
  Decisions: "decisions",
  "Action Needed": "actionNeeded",
  "Workspace Access": "workspaceAccess",
  Analysis: "analysis",
  Insights: "insights",
  Forecasts: "forecasts",
  Reports: "reports",
  Alerts: "alerts",
  Relationships: "relationships",
  Data: "data",
  Datasets: "datasets",
  "Entity Matching": "entityMatching",
  Connections: "connections",
  Manage: "manage",
  Settings: "settings",
  Billing: "billing",
  Support: "support",
  "Help & Support": "helpSupport",
}

function getDashboardNavigationLabel(
  language: DecisionateLanguage,
  label: string
) {
  const translationKey =
    dashboardNavigationTranslationKeys[label]

  return translationKey
    ? getDecisionateText(language, translationKey)
    : label
}

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
  // The drawer is closed from navigation click handlers. Keeping the update in
  // the user event avoids an effect-driven state update after every pathname
  // change and still closes the drawer before the new page renders on mobile.
  const [mobileNavOpen, setMobileNavOpen] =
    useState(false)
  const navigationRef = useRef<HTMLElement>(null)
  const isMobileNavigation = useSyncExternalStore(
    subscribeToMobileNavigation,
    getMobileNavigationSnapshot,
    getServerMobileNavigationSnapshot,
  )
  const [apiUnavailableMessage, setApiUnavailableMessage] =
    useState(() => {
      const initialDetail =
        getApiAvailabilitySnapshot()

      return initialDetail && !initialDetail.available
        ? initialDetail.message ||
            "The service is temporarily unavailable."
        : ""
    })
  const [subscriptionAccess, setSubscriptionAccess] =
    useState<BillingAccessStatus | null>(null)
  const [subscriptionAccessKey, setSubscriptionAccessKey] =
    useState("")
  const [maintenanceNotice, setMaintenanceNotice] =
    useState<MaintenanceNotice | null>(null)
  const { activeWorkspaceId } =
    useActiveWorkspace(user?.id)
  const clerkButtonMounted = useSyncExternalStore(
    subscribeToClientMount,
    getClientMountSnapshot,
    getServerMountSnapshot
  )
  const language = useSyncExternalStore(
    subscribeToDecisionateLanguage,
    getCurrentDecisionateLanguage,
    getServerDecisionateLanguage
  )
  const text = (key: DecisionateTranslationKey) =>
    getDecisionateText(language, key)

  const activeCollapsibleGroupLabel =
    dashboardNavGroups.find(
      group =>
        group.collapsible &&
        group.items.some(item =>
          isActiveDashboardPath(pathname, item.href)
        )
    )?.label

  const activeNavItem = dashboardNavGroups.flatMap(group => group.items).find(
    item => isActiveDashboardPath(pathname, item.href)
  )

  useEffect(() => {
    if (!mobileNavOpen || !isMobileNavigation) return
    const navigation = navigationRef.current
    if (!navigation) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const getFocusable = () => Array.from(navigation.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), select:not([disabled]), [tabindex="0"]'
    )).filter(element => element.getClientRects().length > 0)

    ;(getFocusable()[0] ?? navigation).focus()
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        setMobileNavOpen(false)
      }
      if (event.key !== "Tab") return
      const elements = getFocusable()
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (!first || !last) {
        event.preventDefault()
        navigation?.focus()
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === navigation)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [mobileNavOpen, isMobileNavigation])

  useEffect(() => {
    if (!user?.id) {
      return
    }

    let ignoreResult = false
    const loadMaintenanceNotice = async () => {
      try {
        const notice = await getActiveMaintenanceNotice()
        if (!ignoreResult) {
          setMaintenanceNotice(notice)
        }
      } catch {
        // Maintenance is supplementary UI; a failed status check must not
        // block workspace navigation or surface a false platform outage.
      }
    }

    void loadMaintenanceNotice()
    const refreshId = window.setInterval(
      loadMaintenanceNotice,
      60_000
    )

    return () => {
      ignoreResult = true
      window.clearInterval(refreshId)
    }
  }, [user?.id])

  useEffect(() => {
    if (
      !user?.id ||
      (pathname === "/dashboard/billing" && subscriptionAccess?.billing_enabled !== false)
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
    subscriptionAccess?.billing_enabled,
    user?.id,
    user?.primaryEmailAddress?.emailAddress,
  ])

  useEffect(() => {
    if (
      !user?.id ||
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
          "The service is temporarily unavailable."
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
    <div className="dashboard-shell-layout flex h-dvh overflow-hidden bg-gray-50">
      <a href="#workspace-content" className="workspace-skip-link dashboard-print-hidden rounded-lg bg-white px-4 py-3 text-sm font-medium shadow-lg">
        Skip to content
      </a>
      {/* =========================
          Dashboard Sidebar Brand Workspace And Primary Navigation
      ========================= */}

      {mobileNavOpen && (
        <button
          type="button"
          aria-label={text("closeNavigation")}
          className="dashboard-print-hidden fixed inset-0 z-30 bg-gray-950/30 xl:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <aside
        id="dashboard-sidebar"
        ref={navigationRef}
        role={isMobileNavigation && mobileNavOpen ? "dialog" : undefined}
        aria-modal={isMobileNavigation && mobileNavOpen ? true : undefined}
        inert={isMobileNavigation && !mobileNavOpen}
        tabIndex={-1}
        aria-label={text("dashboardNavigation")}
        className={`dashboard-print-hidden fixed inset-y-0 left-0 z-40 flex h-dvh w-[min(18rem,calc(100vw-2rem))] shrink-0 flex-col border-r bg-white shadow-xl transition-transform duration-200 xl:static xl:z-auto xl:w-60 xl:translate-x-0 xl:shadow-none ${
          mobileNavOpen
            ? "translate-x-0"
            : "-translate-x-full"
        }`}
      >
        <div className="shrink-0 border-b px-4 py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg text-sm font-bold text-white"
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
              <p
                title={displayBrand.name}
                className="truncate text-base font-semibold"
                style={{
                  color: "var(--decisionate-brand-primary-text)",
                }}
              >
                {displayBrand.name}
              </p>

              <p className="truncate text-xs text-gray-400">
                {activeSharedWorkspace
                  ? `${formatWorkspaceRole(
                    activeSharedWorkspace.role
                  )} ${text("portal")}`
                  : visibleOrganization
                    ? text("businessWorkspace")
                    : text("workspace")}
                </p>
            </div>
            </div>

            <button
              type="button"
              aria-label={text("closeNavigation")}
              title={text("closeNavigationShort")}
              className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 xl:hidden"
              onClick={() => setMobileNavOpen(false)}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          {canSwitchWorkspaces && workspaceOptions.length > 1 && (
            <select
              aria-label={text("workspace")}
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

        <nav aria-label={text("dashboardNavigation")} className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <div className="space-y-4">
            {dashboardNavGroups.map((group) => {
              const groupRoleVisible =
                !group.roles ||
                group.roles.includes(
                  activeWorkspaceRole as
                    | "owner"
                    | "member"
                    | "client"
                    | "client_owner"
                    | "client_user"
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
                  item => item.href !== "/dashboard/billing" || subscriptionAccess?.billing_enabled !== false
                ).filter(
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
                        | "client_owner"
                        | "client_user"
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
                  (group.label !== "Manage" || group.label === activeCollapsibleGroupLabel)
                )

              return (
                <div key={group.label}>
                  {group.collapsible ? (
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      aria-controls={`dashboard-nav-${group.label.toLowerCase()}`}
                      onClick={() =>
                        setExpandedNavGroups(current => ({
                          ...current,
                          [group.label]: !isExpanded,
                        }))
                      }
                      className="flex min-h-9 w-full items-center justify-between rounded-md px-3 py-2 text-left text-xs font-semibold text-gray-500 transition hover:bg-gray-50 hover:text-gray-800"
                    >
                      <span>
                        {getDashboardNavigationLabel(
                          language,
                          group.label
                        )}
                      </span>
                      {isExpanded ? (
                        <ChevronDown size={15} aria-hidden="true" />
                      ) : (
                        <ChevronRight size={15} aria-hidden="true" />
                      )}
                    </button>
                  ) : (
                    <p className="mb-2 px-3 text-xs font-semibold text-gray-500">
                      {getDashboardNavigationLabel(
                        language,
                        group.label
                      )}
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
                          aria-current={isActiveDashboardPath(pathname, item.href) ? "page" : undefined}
                          onClick={() => setMobileNavOpen(false)}
                          className={getNavLinkClass(
                            isActiveDashboardPath(
                              pathname,
                              item.href
                            )
                          )}
                        >
                          {item.icon}
                          {getDashboardNavigationLabel(
                            language,
                            item.label
                          )}
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

        <div className="shrink-0 border-t px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 xl:hidden">
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
              <span className="min-w-0 truncate text-xs font-medium text-gray-600">
                {user?.fullName ?? text("account")}
              </span>
            </div>

            <ThemeToggle className="shrink-0" />
          </div>

          <div className="hidden min-w-0 items-center justify-between gap-3 xl:flex">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-800">
                {user?.fullName ?? text("account")}
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

      <div className="flex min-w-0 flex-1 flex-col" inert={isMobileNavigation && mobileNavOpen}>
        <div className="dashboard-print-hidden flex shrink-0 items-center gap-3 border-b bg-white px-4 py-3 xl:hidden">
          <button
            type="button"
            aria-expanded={mobileNavOpen}
            aria-controls="dashboard-sidebar"
            aria-label={text("openNavigation")}
            title={text("openNavigationShort")}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 shadow-sm transition hover:bg-gray-50 hover:text-gray-950"
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-gray-900">{displayWorkspaceName}</p>
            <p className="truncate text-xs text-gray-500">
              {getDashboardNavigationLabel(language, activeNavItem?.label ?? "Workspace")}
            </p>
          </div>
          <ThemeToggle />
        </div>

      <main id="workspace-content" tabIndex={-1} className="dashboard-print-main min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 xl:p-8">
        {apiUnavailableMessage && (
          <div role="alert" className="dashboard-print-hidden mb-5 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 break-words">{apiUnavailableMessage}</span>
            <button type="button" onClick={() => window.location.reload()} title={text("reload")} aria-label={text("reload")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-red-200 bg-white hover:bg-red-100">
              <RefreshCw size={16} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setApiUnavailableMessage("")} title={text("dismiss")} aria-label={text("dismiss")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-red-100">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}

        {maintenanceNotice && (
          <MaintenanceBanner notice={maintenanceNotice} />
        )}

        {subscriptionAccessBlocked && subscriptionAccess ? (
          <SubscriptionRequiredPanel
            access={subscriptionAccess}
            canManageBilling={canConfigureWorkspace}
            isClientWorkspaceContext={isClientWorkspaceContext}
          />
        ) : (
          children
        )}
      </main>
      </div>
    </div>
  )
}

function MaintenanceBanner({
  notice,
}: {
  notice: MaintenanceNotice
}) {
  const scheduledDate = new Date(notice.scheduled_at)
  const scheduledText = Number.isNaN(scheduledDate.getTime())
    ? "Scheduled time unavailable"
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "full",
        timeStyle: "short",
      }).format(scheduledDate)

  return (
    <section
      role="status"
      aria-live="polite"
      className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950 shadow-sm sm:px-5"
    >
      <div className="flex items-start gap-3">
        <Wrench
          size={20}
          className="mt-0.5 shrink-0 text-amber-700"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">
            Upcoming maintenance
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm font-medium leading-6">
            {notice.message}
          </p>
          <p className="mt-1 text-xs text-amber-800">
            Scheduled for {scheduledText} (your local time)
          </p>
        </div>
      </div>
    </section>
  )
}

function SubscriptionRequiredPanel({
  access,
  canManageBilling,
  isClientWorkspaceContext,
}: {
  access: BillingAccessStatus
  canManageBilling: boolean
  isClientWorkspaceContext: boolean
}) {
  const isClientSubscriptionExpired =
    isClientWorkspaceContext &&
    access.status === "expired"
  const title =
    isClientSubscriptionExpired
      ? "Contact your agency"
      : access.status === "grace_period"
      ? "Payment needs attention"
      : "Subscription required"
  const description =
    isClientSubscriptionExpired
      ? "This client workspace is managed by an agency whose subscription has expired. Contact the agency to restore access."
      : access.status === "grace_period"
      ? "Your workspace remains available during the billing grace period, but billing details must be updated to keep access."
      : access.status === "expired"
      ? "Your subscription has expired. Choose a monthly or annual plan to restore access."
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
        {canManageBilling && !isClientWorkspaceContext ? (
          access.status === "expired" ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-sm font-medium text-gray-700">
                Renew with:
              </span>
              <Link
                href="/dashboard/billing?billing_interval=month"
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--decisionate-brand-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                <CreditCard size={16} aria-hidden="true" />
                Monthly
              </Link>
              <Link
                href="/dashboard/billing?billing_interval=year"
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--decisionate-brand-primary)] px-4 py-2 text-sm font-medium text-[var(--decisionate-brand-primary-text)] hover:bg-[var(--decisionate-brand-primary-soft)]"
              >
                Annual
              </Link>
            </div>
          ) : (
            <Link
              href="/dashboard/billing"
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--decisionate-brand-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              <CreditCard size={16} aria-hidden="true" />
              Open billing
            </Link>
          )
        ) : (
          <p className="text-sm font-medium text-gray-700">
            {isClientWorkspaceContext
              ? "Contact the agency that manages this workspace to renew the subscription."
              : "Ask the workspace owner to update billing."}
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
  return `flex min-h-10 items-center gap-3 rounded-md border-l-2 px-3 py-2 text-sm font-medium transition ${
    active
      ? "border-[var(--decisionate-brand-primary)] bg-[var(--decisionate-brand-primary-soft)] text-[var(--decisionate-brand-primary-text)]"
      : "border-transparent text-gray-600 hover:bg-gray-50 hover:text-gray-900"
  }`
}
