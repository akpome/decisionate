"use client"

import {
  Activity,
  BarChart3,
  BrainCircuit,
  Building2,
  CalendarDays,
  Coins,
  Database,
  Download,
  FileCheck2,
  Gauge,
  LogOut,
  Mail,
  RefreshCw,
  Trash2,
  Users,
} from "lucide-react"
import {
  UserButton,
  useClerk,
  useUser,
} from "@clerk/nextjs"
import { Fragment, useEffect, useState } from "react"

import {
  addPlatformAdminOrganizationInvite,
  addPlatformAdminAdministrators,
  addPlatformAdminMember,
  createPlatformAdminOrganization,
  deletePlatformAdminOrganization,
  deletePlatformAdminUser,
  getPlatformAdminAlertDeliveries,
  getPlatformAdminAccessDetails,
  getPlatformAdminAuditEvents,
  getPlatformAdminCreditSettings,
  getPlatformAdminEmailSettings,
  getPlatformAdminOrganizationInvites,
  getPlatformAdminOrganizationMembers,
  getPlatformAdminOrganizations,
  getPlatformAdminOverview,
  getPlatformAdminUsageActivity,
  getPlatformAdminUsers,
  linkPlatformAdminIdentity,
  removePlatformAdminOrganizationInvite,
  removePlatformAdminMember,
  type PlatformAdminMember,
  type PlatformAdminInvite,
  type PlatformAdminAuditEvent,
  type PlatformAdminAlertDelivery,
  type PlatformAdminAccessDetails,
  type PlatformAdminCreditSettings,
  type PlatformAdminEmailSettings,
  type PlatformAdminOrganization,
  type PlatformAdminOverview,
  type PlatformAdminUsage,
  type PlatformAdminUser,
  updatePlatformAdminEmailSettings,
  updatePlatformAdminOrganizationSubscription,
  updatePlatformAdminCreditSettings,
  updatePlatformAdminMemberRole,
} from "@/lib/api"

function formatCount(value: number) {
  return value.toLocaleString()
}

function dateInputValue(value?: string | null) {
  return value ? value.slice(0, 10) : ""
}

function dateExpiryPayload(value: string) {
  return value
    ? new Date(`${value}T23:59:59`).toISOString()
    : null
}

function downloadCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<unknown>>,
) {
  const escapeCell = (value: unknown) => {
    const text = String(value ?? "")
    return `"${text.replaceAll('"', '""')}"`
  }
  const csv = [headers, ...rows]
    .map(row => row.map(escapeCell).join(","))
    .join("\n")
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" })
  )
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

const creditSettingFields = [
  { key: "free_ai_credits", label: "Free" },
  { key: "professional_ai_credits", label: "Professional" },
  { key: "agency_ai_credits", label: "Agency" },
  { key: "agency_client_ai_credits", label: "Agency client" },
  {
    key: "additional_client_workspace_ai_credits",
    label: "Additional client workspace",
  },
  { key: "ai_credit_pack_size", label: "AI credit pack" },
] as const

function MetricCard({
  label,
  value,
  icon,
}: {
  label: string
  value: number
  icon: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <span className="text-blue-600">{icon}</span>
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-gray-900">
        {formatCount(value)}
      </p>
    </section>
  )
}

export default function PlatformAdminPage() {
  const { signOut } = useClerk()
  const { user } = useUser()
  const currentUserEmail =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress
  const [overview, setOverview] =
    useState<PlatformAdminOverview | null>(null)
  const [organizations, setOrganizations] =
    useState<PlatformAdminOrganization[]>([])
  const [provisionForm, setProvisionForm] = useState({
    name: "",
    owner_email: "",
    plan: "free",
    billing_expires_at: "",
    member_emails: "",
  })
  const [provisioning, setProvisioning] = useState(false)
  const [provisionError, setProvisionError] = useState("")
  const [provisionMessage, setProvisionMessage] = useState("")
  const [platformUsers, setPlatformUsers] =
    useState<PlatformAdminUser[]>([])
  const [platformUsersLoading, setPlatformUsersLoading] =
    useState(true)
  const [platformUsersError, setPlatformUsersError] =
    useState("")
  const [adminAccess, setAdminAccess] =
    useState<PlatformAdminAccessDetails | null>(null)
  const [adminAccessLoading, setAdminAccessLoading] =
    useState(true)
  const [adminAccessError, setAdminAccessError] =
    useState("")
  const [adminTargetReference, setAdminTargetReference] =
    useState("")
  const [adminPermissionDraft, setAdminPermissionDraft] =
    useState<string[]>([])
  const [adminGranting, setAdminGranting] =
    useState(false)
  const [adminGrantError, setAdminGrantError] =
    useState("")
  const [adminGrantMessage, setAdminGrantMessage] =
    useState("")
  const [identityLinkTarget, setIdentityLinkTarget] =
    useState("")
  const [identityLinking, setIdentityLinking] =
    useState(false)
  const [identityLinkError, setIdentityLinkError] =
    useState("")
  const [destructiveActionId, setDestructiveActionId] =
    useState<string | null>(null)
  const [destructiveError, setDestructiveError] =
    useState("")
  const [destructiveMessage, setDestructiveMessage] =
    useState("")
  const [deleteConfirmationId, setDeleteConfirmationId] =
    useState<number | null>(null)
  const [deleteConfirmationText, setDeleteConfirmationText] =
    useState("")
  const [deleteModalOrganization, setDeleteModalOrganization] =
    useState<PlatformAdminOrganization | null>(null)
  const [selectedOrganizationId, setSelectedOrganizationId] =
    useState<number | null>(null)
  const [members, setMembers] =
    useState<PlatformAdminMember[]>([])
  const [invites, setInvites] =
    useState<PlatformAdminInvite[]>([])
  const [auditEvents, setAuditEvents] =
    useState<PlatformAdminAuditEvent[]>([])
  const [auditLoading, setAuditLoading] =
    useState(true)
  const [auditError, setAuditError] =
    useState("")
  const [auditSearch, setAuditSearch] = useState("")
  const [alertDeliveries, setAlertDeliveries] =
    useState<PlatformAdminAlertDelivery[]>([])
  const [alertDeliveriesLoading, setAlertDeliveriesLoading] =
    useState(true)
  const [alertDeliveriesError, setAlertDeliveriesError] =
    useState("")
  const [alertDeliveryFilter, setAlertDeliveryFilter] =
    useState<"all" | "failed" | "sent">("all")
  const [alertSearch, setAlertSearch] = useState("")
  const [usageActivity, setUsageActivity] =
    useState<PlatformAdminUsage | null>(null)
  const [usageActivityLoading, setUsageActivityLoading] =
    useState(true)
  const [usageActivityError, setUsageActivityError] =
    useState("")
  const [usagePeriodDays, setUsagePeriodDays] =
    useState("30")
  const [usageSearch, setUsageSearch] = useState("")
  const [membersLoading, setMembersLoading] =
    useState(false)
  const [membersError, setMembersError] =
    useState("")
  const [memberRoleDrafts, setMemberRoleDrafts] =
    useState<Record<number, "member" | "client">>({})
  const [memberActionId, setMemberActionId] =
    useState<number | null>(null)
  const [memberUserId, setMemberUserId] =
    useState("")
  const [memberRole, setMemberRole] =
    useState<"member" | "client">("member")
  const [addingMember, setAddingMember] =
    useState(false)
  const [inviteEmail, setInviteEmail] =
    useState("")
  const [inviteRole, setInviteRole] =
    useState<"member" | "client">("client")
  const [addingInvite, setAddingInvite] =
    useState(false)
  const [inviteError, setInviteError] =
    useState("")
  const [inviteActionId, setInviteActionId] =
    useState<number | null>(null)
  const [billingPlan, setBillingPlan] = useState("free")
  const [billingExpiresAt, setBillingExpiresAt] = useState("")
  const [billingSaving, setBillingSaving] = useState(false)
  const [billingError, setBillingError] = useState("")
  const [billingMessage, setBillingMessage] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [emailSettings, setEmailSettings] =
    useState<PlatformAdminEmailSettings | null>(null)
  const [emailSettingsLoading, setEmailSettingsLoading] =
    useState(true)
  const [emailSettingsError, setEmailSettingsError] =
    useState("")
  const [emailSettingsMessage, setEmailSettingsMessage] =
    useState("")
  const [emailSettingsSaving, setEmailSettingsSaving] =
    useState(false)
  const [creditSettings, setCreditSettings] =
    useState<PlatformAdminCreditSettings | null>(null)
  const [creditSettingsLoading, setCreditSettingsLoading] =
    useState(true)
  const [creditSettingsError, setCreditSettingsError] =
    useState("")
  const [creditSettingsMessage, setCreditSettingsMessage] =
    useState("")
  const [creditSettingsSaving, setCreditSettingsSaving] =
    useState(false)
  const [creditForm, setCreditForm] = useState({
    free_ai_credits: "1000",
    professional_ai_credits: "5000",
    agency_ai_credits: "25000",
    agency_client_ai_credits: "2500",
    additional_client_workspace_ai_credits: "2500",
    ai_credit_pack_size: "5000",
  })
  const [emailForm, setEmailForm] = useState({
    provider: "smtp" as "smtp" | "resend",
    resend_api_key: "",
    clear_resend_api_key: false,
    resend_from_email: "",
    resend_from_name: "Decisionate",
    smtp_host: "",
    smtp_port: "587",
    smtp_username: "",
    smtp_password: "",
    clear_password: false,
    smtp_from_email: "",
    smtp_from_name: "Decisionate",
    smtp_use_tls: true,
    smtp_use_ssl: false,
  })
  const [retryKey, setRetryKey] = useState(0)
  const [organizationSearch, setOrganizationSearch] =
    useState("")
  const [userSearch, setUserSearch] =
    useState("")

  useEffect(() => {
    if (!user?.id) {
      return
    }

    let ignoreResult = false

    getPlatformAdminAccessDetails(user.id)
      .then((access) => {
        if (ignoreResult) {
          return
        }
        setLoading(true)
        setAdminAccessError("")
        setAdminAccess(access)
        setAdminAccessLoading(false)
        if (!access.allowed) {
          setError("Platform admin access is unavailable.")
          setLoading(false)
          return
        }

        const canView = (permission: string) =>
          access.full_access || access.permissions.includes(permission)
        const tasks: Promise<unknown>[] = []

        if (canView("overview")) {
          tasks.push(
            getPlatformAdminOverview(user.id)
              .then((overviewData) => {
                if (!ignoreResult) {
                  setOverview(overviewData)
                }
              })
              .catch(() => {
                if (!ignoreResult) {
                  setOverview(null)
                }
              })
          )
        }

        if (canView("workspaces")) {
          tasks.push(
            getPlatformAdminOrganizations(user.id)
              .then((organizationData) => {
                if (!ignoreResult) {
                  setOrganizations(organizationData)
                }
              })
              .catch(() => {
                if (!ignoreResult) {
                  setOrganizations([])
                }
              })
          )
        }

        if (canView("audit")) {
          setAuditLoading(true)
          tasks.push(
            getPlatformAdminAuditEvents(user.id)
              .then((auditData) => {
                if (!ignoreResult) {
                  setAuditEvents(auditData)
                  setAuditError("")
                }
              })
              .catch((loadError) => {
                if (!ignoreResult) {
                  setAuditError(
                    loadError instanceof Error
                      ? loadError.message
                      : "Platform admin audit history is unavailable."
                  )
                }
              })
              .finally(() => {
                if (!ignoreResult) {
                  setAuditLoading(false)
                }
              })
          )
        } else {
          setAuditLoading(false)
        }

        if (canView("alerts")) {
          setAlertDeliveriesLoading(true)
          tasks.push(
            getPlatformAdminAlertDeliveries(user.id)
              .then((deliveryData) => {
                if (!ignoreResult) {
                  setAlertDeliveries(deliveryData)
                  setAlertDeliveriesError("")
                }
              })
              .catch((loadError) => {
                if (!ignoreResult) {
                  setAlertDeliveriesError(
                    loadError instanceof Error
                      ? loadError.message
                      : "Platform alert delivery history is unavailable."
                  )
                }
              })
              .finally(() => {
                if (!ignoreResult) {
                  setAlertDeliveriesLoading(false)
                }
              })
          )
        } else {
          setAlertDeliveriesLoading(false)
        }

        if (canView("users")) {
          setPlatformUsersLoading(true)
          tasks.push(
            getPlatformAdminUsers(
              user.id,
              undefined,
              100,
              currentUserEmail
            )
              .then((userData) => {
                if (!ignoreResult) {
                  setPlatformUsers(userData)
                  setPlatformUsersError("")
                }
              })
              .catch((loadError) => {
                if (!ignoreResult) {
                  setPlatformUsersError(
                    loadError instanceof Error
                      ? loadError.message
                      : "Platform users are unavailable."
                  )
                }
              })
              .finally(() => {
                if (!ignoreResult) {
                  setPlatformUsersLoading(false)
                }
              })
          )
        } else {
          setPlatformUsersLoading(false)
        }

        if (canView("email_settings")) {
          setEmailSettingsLoading(true)
          tasks.push(
            getPlatformAdminEmailSettings(user.id)
              .then((settings) => {
                if (!ignoreResult) {
                  setEmailSettings(settings)
                  setEmailForm({
                    provider: settings.provider,
                    resend_api_key: "",
                    clear_resend_api_key: false,
                    resend_from_email: settings.resend_from_email,
                    resend_from_name: settings.resend_from_name,
                    smtp_host: settings.smtp_host,
                    smtp_port: String(settings.smtp_port),
                    smtp_username: settings.smtp_username,
                    smtp_password: "",
                    clear_password: false,
                    smtp_from_email: settings.smtp_from_email,
                    smtp_from_name: settings.smtp_from_name,
                    smtp_use_tls: settings.smtp_use_tls,
                    smtp_use_ssl: settings.smtp_use_ssl,
                  })
                  setEmailSettingsError("")
                }
              })
              .catch((loadError) => {
                if (!ignoreResult) {
                  setEmailSettingsError(
                    loadError instanceof Error
                      ? loadError.message
                      : "Decisionate email settings are unavailable."
                  )
                }
              })
              .finally(() => {
                if (!ignoreResult) {
                  setEmailSettingsLoading(false)
                }
              })
          )
        } else {
          setEmailSettingsLoading(false)
        }

        if (canView("credit_settings")) {
          setCreditSettingsLoading(true)
          tasks.push(
            getPlatformAdminCreditSettings(user.id)
              .then((settings) => {
                if (!ignoreResult) {
                  setCreditSettings(settings)
                  setCreditForm({
                    free_ai_credits: String(settings.free_ai_credits),
                    professional_ai_credits: String(settings.professional_ai_credits),
                    agency_ai_credits: String(settings.agency_ai_credits),
                    agency_client_ai_credits: String(settings.agency_client_ai_credits),
                    additional_client_workspace_ai_credits: String(
                      settings.additional_client_workspace_ai_credits
                    ),
                    ai_credit_pack_size: String(settings.ai_credit_pack_size),
                  })
                  setCreditSettingsError("")
                }
              })
              .catch((loadError) => {
                if (!ignoreResult) {
                  setCreditSettingsError(
                    loadError instanceof Error
                      ? loadError.message
                      : "Decisionate credit settings are unavailable."
                  )
                }
              })
              .finally(() => {
                if (!ignoreResult) {
                  setCreditSettingsLoading(false)
                }
              })
          )
        } else {
          setCreditSettingsLoading(false)
        }

        Promise.all(tasks).finally(() => {
          if (!ignoreResult) {
            setLoading(false)
          }
        })
      })
      .catch((loadError) => {
        if (!ignoreResult) {
          setAdminAccess(null)
          setAdminAccessError(
            loadError instanceof Error
              ? loadError.message
              : "Platform admin access is unavailable."
          )
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Platform admin access is unavailable."
          )
          setAdminAccessLoading(false)
          setLoading(false)
        }
      })

    return () => {
      ignoreResult = true
    }
  }, [
    retryKey,
    user?.id,
    currentUserEmail,
  ])

  useEffect(() => {
    if (!user?.id || !adminAccess) {
      return
    }

    if (
      !adminAccess.full_access &&
      !adminAccess.permissions.includes("analytics")
    ) {
      return
    }

    let ignoreResult = false

    getPlatformAdminUsageActivity(
      user.id,
      Number(usagePeriodDays)
    )
      .then((usageData) => {
        if (!ignoreResult) {
          setUsageActivity(usageData)
          setUsageActivityError("")
        }
      })
      .catch((loadError) => {
        if (!ignoreResult) {
          setUsageActivity(null)
          setUsageActivityError(
            loadError instanceof Error
              ? loadError.message
              : "Platform usage activity is unavailable."
          )
        }
      })
      .finally(() => {
        if (!ignoreResult) {
          setUsageActivityLoading(false)
        }
      })

    return () => {
      ignoreResult = true
    }
  }, [adminAccess, retryKey, usagePeriodDays, user?.id])

  async function handleSaveEmailSettings(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault()
    if (!user?.id) {
      return
    }

    setEmailSettingsSaving(true)
    setEmailSettingsError("")
    setEmailSettingsMessage("")
    try {
      const settings = await updatePlatformAdminEmailSettings(
        user.id,
        {
          provider: emailForm.provider,
          ...(emailForm.resend_api_key
            ? { resend_api_key: emailForm.resend_api_key }
            : {}),
          clear_resend_api_key: emailForm.clear_resend_api_key,
          resend_from_email: emailForm.resend_from_email,
          resend_from_name: emailForm.resend_from_name,
          smtp_host: emailForm.smtp_host,
          smtp_port: Number(emailForm.smtp_port) || 587,
          smtp_username: emailForm.smtp_username,
          ...(emailForm.smtp_password
            ? { smtp_password: emailForm.smtp_password }
            : {}),
          clear_password: emailForm.clear_password,
          smtp_from_email: emailForm.smtp_from_email,
          smtp_from_name: emailForm.smtp_from_name,
          smtp_use_tls: emailForm.smtp_use_tls,
          smtp_use_ssl: emailForm.smtp_use_ssl,
        }
      )
      setEmailSettings(settings)
      setEmailForm(currentForm => ({
        ...currentForm,
        smtp_password: "",
        resend_api_key: "",
        clear_password: false,
        clear_resend_api_key: false,
      }))
      setEmailSettingsMessage("Decisionate email settings saved.")
    } catch (saveError) {
      setEmailSettingsError(
        saveError instanceof Error
          ? saveError.message
          : "Decisionate email settings could not be saved."
      )
    } finally {
      setEmailSettingsSaving(false)
    }
  }

  async function handleSaveCreditSettings(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault()
    if (!user?.id) {
      return
    }

    setCreditSettingsSaving(true)
    setCreditSettingsError("")
    setCreditSettingsMessage("")
    try {
      const settings = await updatePlatformAdminCreditSettings(
        user.id,
        Object.fromEntries(
          creditSettingFields.map(field => [
            field.key,
            Math.max(Number(creditForm[field.key]) || 0, 0),
          ])
        )
      )
      setCreditSettings(settings)
      setCreditSettingsMessage("AI credit allocations saved.")
    } catch (saveError) {
      setCreditSettingsError(
        saveError instanceof Error
          ? saveError.message
          : "AI credit allocations could not be saved."
      )
    } finally {
      setCreditSettingsSaving(false)
    }
  }

  async function refreshPlatformSummary() {
    if (!user?.id) {
      return
    }

    try {
      const tasks: Promise<unknown>[] = []
      if (canView("overview")) {
        tasks.push(
          getPlatformAdminOverview(user.id).then(setOverview)
        )
      }
      if (canView("workspaces")) {
        tasks.push(
          getPlatformAdminOrganizations(user.id).then(setOrganizations)
        )
      }
      await Promise.all(tasks)
      setError("")
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Platform admin summary is unavailable."
      )
    }
  }

  async function handleProvisionWorkspace() {
    if (
      !user?.id ||
      !provisionForm.name.trim() ||
      !provisionForm.owner_email.trim()
    ) {
      return
    }

    setProvisioning(true)
    setProvisionError("")
    setProvisionMessage("")
    try {
      const created = await createPlatformAdminOrganization(
        user.id,
        {
          name: provisionForm.name.trim(),
          owner_email: provisionForm.owner_email.trim(),
          plan: provisionForm.plan,
          billing_expires_at: dateExpiryPayload(
            provisionForm.billing_expires_at
          ),
          member_emails: provisionForm.member_emails
            .split(/[\n,]+/)
            .map(email => email.trim())
            .filter(Boolean),
        }
      )
      setOrganizations(currentOrganizations => [
        created,
        ...currentOrganizations.filter(
          organization => organization.id !== created.id
        ),
      ])
      setProvisionForm({
        name: "",
        owner_email: "",
        plan: "free",
        billing_expires_at: "",
        member_emails: "",
      })
      setProvisionMessage(
        "Workspace created. The owner and member invitations are pending in the workspace controls below."
      )
      await refreshPlatformSummary()
      await handleViewMembers(created.id)
    } catch (createError) {
      setProvisionError(
        createError instanceof Error
          ? createError.message
          : "Workspace could not be provisioned."
      )
    } finally {
      setProvisioning(false)
    }
  }

  async function refreshAuditEvents() {
    if (!user?.id || !canView("audit")) {
      return
    }

    setAuditLoading(true)
    try {
      setAuditEvents(await getPlatformAdminAuditEvents(user.id))
      setAuditError("")
    } catch (loadError) {
      setAuditError(
        loadError instanceof Error
          ? loadError.message
          : "Platform admin audit history is unavailable."
      )
    } finally {
      setAuditLoading(false)
    }
  }

  async function refreshUsageActivity() {
    if (!user?.id || !canView("analytics")) {
      return
    }

    setUsageActivityLoading(true)
    try {
      setUsageActivity(
        await getPlatformAdminUsageActivity(
          user.id,
          Number(usagePeriodDays)
        )
      )
      setUsageActivityError("")
    } catch (loadError) {
      setUsageActivityError(
        loadError instanceof Error
          ? loadError.message
          : "Platform usage activity is unavailable."
      )
    } finally {
      setUsageActivityLoading(false)
    }
  }

  async function handleViewMembers(
    organizationId: number
  ) {
    if (!user?.id) {
      return
    }

    setSelectedOrganizationId(organizationId)
    setMembersLoading(true)
    setMembersError("")
    setBillingError("")
    setBillingMessage("")
    const selectedOrganization = organizations.find(
      organization => organization.id === organizationId
    )
    if (selectedOrganization) {
      setBillingPlan(selectedOrganization.plan)
      setBillingExpiresAt(
        dateInputValue(selectedOrganization.billing_expires_at)
      )
    }

    try {
      const [data, inviteData] =
        await Promise.all([
          getPlatformAdminOrganizationMembers(
            user.id,
            organizationId
          ),
          getPlatformAdminOrganizationInvites(
            user.id,
            organizationId
          ),
        ])
      setMembers(data)
      setInvites(inviteData)
      setMemberRoleDrafts(
        Object.fromEntries(
          data
            .filter(
              member => member.role === "member" || member.role === "client"
            )
            .map(member => [member.id, member.role])
        ) as Record<number, "member" | "client">
      )
    } catch (loadError) {
      setMembers([])
      setInvites([])
      setMembersError(
        loadError instanceof Error
          ? loadError.message
          : "Organization members are unavailable."
      )
    } finally {
      setMembersLoading(false)
    }
  }

  async function handleSaveBilling() {
    if (!user?.id || !selectedOrganizationId) {
      return
    }

    if (billingPlan === "client") {
      setBillingError(
        "Client workspace billing is managed by its agency workspace."
      )
      return
    }

    setBillingSaving(true)
    setBillingError("")
    setBillingMessage("")
    try {
      const updated =
        await updatePlatformAdminOrganizationSubscription(
          user.id,
          selectedOrganizationId,
          {
            plan: billingPlan,
            billing_expires_at: dateExpiryPayload(
              billingExpiresAt
            ),
          }
        )
      setOrganizations(currentOrganizations =>
        currentOrganizations.map(organization =>
          organization.id === updated.id
            ? updated
            : organization
        )
      )
      setBillingMessage("Billing details saved.")
      await refreshAuditEvents()
    } catch (saveError) {
      setBillingError(
        saveError instanceof Error
          ? saveError.message
          : "Billing details could not be saved."
      )
    } finally {
      setBillingSaving(false)
    }
  }

  async function handleUpdateMemberRole(
    member: PlatformAdminMember
  ) {
    if (!user?.id || !selectedOrganizationId) {
      return
    }

    const role = memberRoleDrafts[member.id]
    if (!role || role === member.role) {
      return
    }

    setMemberActionId(member.id)
    setMembersError("")

    try {
      const updatedMember =
        await updatePlatformAdminMemberRole(
          user.id,
          selectedOrganizationId,
          member.id,
          role
        )
      setMembers(currentMembers =>
        currentMembers.map(currentMember =>
          currentMember.id === updatedMember.id
            ? updatedMember
            : currentMember
        )
      )
      await refreshAuditEvents()
    } catch (updateError) {
      setMembersError(
        updateError instanceof Error
          ? updateError.message
          : "Member role could not be updated."
      )
    } finally {
      setMemberActionId(null)
    }
  }

  async function handleAddMember(
    userReference = memberUserId,
  ) {
    if (!user?.id || !selectedOrganizationId || !userReference.trim()) {
      return
    }

    setAddingMember(true)
    setMembersError("")

    try {
      const newMember =
        await addPlatformAdminMember(
          user.id,
          selectedOrganizationId,
          userReference,
          memberRole
        )
      setMembers(currentMembers => [
        ...currentMembers,
        newMember,
      ])
      setMemberRoleDrafts(currentDrafts => ({
        ...currentDrafts,
        [newMember.id]: memberRole,
      }))
      setMemberUserId("")
      setMemberRole("member")
      await refreshPlatformSummary()
      await refreshAuditEvents()
    } catch (addError) {
      setMembersError(
        addError instanceof Error
          ? addError.message
          : "Member could not be added."
      )
    } finally {
      setAddingMember(false)
    }
  }

  async function handleLinkCurrentIdentity() {
    if (!user?.id || !identityLinkTarget.trim()) {
      return
    }

    setIdentityLinking(true)
    setIdentityLinkError("")

    try {
      await linkPlatformAdminIdentity(
        user.id,
        identityLinkTarget.trim()
      )
      setIdentityLinkTarget("")
      window.location.reload()
    } catch (linkError) {
      setIdentityLinkError(
        linkError instanceof Error
          ? linkError.message
          : "Provider identity could not be linked."
      )
    } finally {
      setIdentityLinking(false)
    }
  }

  function handleDeleteOrganization(
    organization: PlatformAdminOrganization,
  ) {
    if (!user?.id) {
      return
    }

    if (deleteConfirmationId !== organization.id) {
      setDeleteConfirmationId(organization.id)
      setDeleteConfirmationText("")
      setDestructiveError("")
      setDestructiveMessage("")
      return
    }
    if (deleteConfirmationText.trim() !== "DELETE WORKSPACE") {
      setDestructiveError(
        "Type DELETE WORKSPACE exactly to confirm this permanent deletion."
      )
      return
    }

    setDestructiveError("")
    setDestructiveMessage("")
    setDeleteModalOrganization(organization)
  }

  async function handleConfirmOrganizationDeletion() {
    const organization = deleteModalOrganization
    if (!user?.id || !organization) {
      return
    }

    setDestructiveActionId(`organization:${organization.id}`)
    setDestructiveError("")
    setDestructiveMessage("")

    try {
      const deletion = await deletePlatformAdminOrganization(
        user.id,
        organization.id,
      )
      setOrganizations(
        await getPlatformAdminOrganizations(user.id),
      )
      if (selectedOrganizationId === organization.id) {
        setSelectedOrganizationId(null)
        setMembers([])
        setInvites([])
      }
      setDeleteConfirmationId(null)
      setDeleteConfirmationText("")
      setDeleteModalOrganization(null)
      setDestructiveMessage(
        `Deleted ${organization.name}: ${
          deletion.summary.workspaces || 0
        } workspace(s), ${
          deletion.summary.users_deleted || 0
        } user account(s), ${
          deletion.summary.datasets || 0
        } dataset(s), and ${
          deletion.summary.decisions || 0
        } decision(s).`
      )
      await refreshPlatformSummary()
      await refreshAuditEvents()
    } catch (deleteError) {
      setDestructiveError(
        deleteError instanceof Error
          ? deleteError.message
          : "Workspace could not be deleted.",
      )
    } finally {
      setDestructiveActionId(null)
    }
  }

  async function handleDeleteUser(
    platformUser: PlatformAdminUser,
  ) {
    if (!user?.id || platformUser.protected) {
      return
    }

    const confirmation = window.prompt(
      `This permanently deletes ${platformUser.email || platformUser.clerk_user_id} and owned workspace data. Type DELETE USER to continue.`,
    )
    if (confirmation !== "DELETE USER") {
      return
    }

    setDestructiveActionId(`user:${platformUser.clerk_user_id}`)
    setDestructiveError("")

    try {
      await deletePlatformAdminUser(
        user.id,
        platformUser.clerk_user_id,
      )
      setPlatformUsers(currentUsers =>
        currentUsers.filter(
          currentUser =>
            currentUser.clerk_user_id !== platformUser.clerk_user_id,
        ),
      )
      await refreshPlatformSummary()
      setOrganizations(
        await getPlatformAdminOrganizations(user.id),
      )
      await refreshAuditEvents()
    } catch (deleteError) {
      setDestructiveError(
        deleteError instanceof Error
          ? deleteError.message
          : "User could not be deleted.",
      )
    } finally {
      setDestructiveActionId(null)
    }
  }

  async function handleAddPlatformAdministrator() {
    const references = adminTargetReference
      .split(/[\n,]+/)
      .map(reference => reference.trim())
      .filter(Boolean)
    if (
      !user?.id ||
      references.length === 0 ||
      adminPermissionDraft.length === 0
    ) {
      return
    }

    setAdminGranting(true)
    setAdminGrantError("")
    setAdminGrantMessage("")
    try {
      const administrators = await addPlatformAdminAdministrators(
        user.id,
        references,
        adminPermissionDraft,
      )
      setAdminTargetReference("")
      setAdminPermissionDraft([])
      setAdminGrantMessage(
        `${administrators.length} platform admin user${administrators.length === 1 ? "" : "s"} added or updated.`
      )
      setPlatformUsers(
        await getPlatformAdminUsers(
          user.id,
          undefined,
          100,
          currentUserEmail,
        )
      )
      await refreshAuditEvents()
    } catch (grantError) {
      setAdminGrantError(
        grantError instanceof Error
          ? grantError.message
          : "Platform admin access could not be saved."
      )
    } finally {
      setAdminGranting(false)
    }
  }

  async function handleAddInvite() {
    if (!user?.id || !selectedOrganizationId || !inviteEmail.trim()) {
      return
    }

    setAddingInvite(true)
    setInviteError("")

    try {
      const invite =
        await addPlatformAdminOrganizationInvite(
          user.id,
          selectedOrganizationId,
          inviteEmail,
          inviteRole
        )
      setInvites(currentInvites => [
        ...currentInvites.filter(
          currentInvite => currentInvite.id !== invite.id
        ),
        invite,
      ])
      setInviteEmail("")
      setInviteRole("client")
      await refreshAuditEvents()
    } catch (addError) {
      setInviteError(
        addError instanceof Error
          ? addError.message
          : "Invite could not be created."
      )
    } finally {
      setAddingInvite(false)
    }
  }

  async function handleRemoveInvite(
    invite: PlatformAdminInvite
  ) {
    if (!user?.id || !selectedOrganizationId) {
      return
    }
    if (!window.confirm(`Cancel the invite for ${invite.email}?`)) {
      return
    }

    setInviteActionId(invite.id)
    setInviteError("")

    try {
      await removePlatformAdminOrganizationInvite(
        user.id,
        selectedOrganizationId,
        invite.id
      )
      setInvites(currentInvites =>
        currentInvites.filter(
          currentInvite => currentInvite.id !== invite.id
        )
      )
      await refreshAuditEvents()
    } catch (removeError) {
      setInviteError(
        removeError instanceof Error
          ? removeError.message
          : "Invite could not be removed."
      )
    } finally {
      setInviteActionId(null)
    }
  }

  async function handleRemoveMember(
    member: PlatformAdminMember
  ) {
    if (!user?.id || !selectedOrganizationId) {
      return
    }
    if (!window.confirm(`Remove ${member.clerk_user_id} from this workspace?`)) {
      return
    }

    setMemberActionId(member.id)
    setMembersError("")

    try {
      await removePlatformAdminMember(
        user.id,
        selectedOrganizationId,
        member.id
      )
      setMembers(currentMembers =>
        currentMembers.filter(
          currentMember => currentMember.id !== member.id
        )
      )
      await refreshPlatformSummary()
      await refreshAuditEvents()
    } catch (removeError) {
      setMembersError(
        removeError instanceof Error
          ? removeError.message
          : "Member could not be removed."
      )
    } finally {
      setMemberActionId(null)
    }
  }

  const visibleOrganizations = organizations.filter(
    organization => {
      const search = organizationSearch.trim().toLowerCase()
      if (!search) {
        return true
      }

      return [
        organization.name,
        organization.owner_user_id,
        organization.owner_email || "",
      ].some(value =>
        value.toLowerCase().includes(search)
      )
    }
  )
  const visibleAuditEvents = auditEvents.filter(event => {
    const search = auditSearch.trim().toLowerCase()
    if (!search) {
      return true
    }
    const organizationName = event.organization_id
      ? organizations.find(
          organization => organization.id === event.organization_id
        )?.name || ""
      : "platform"
    return [
      event.action,
      event.admin_user_id,
      event.target_user_id || "",
      event.target_email || "",
      event.details || "",
      organizationName,
    ].some(value => value.toLowerCase().includes(search))
  })
  const visibleAlertDeliveries = alertDeliveries.filter((delivery) => {
    const matchesStatus = alertDeliveryFilter === "all"
      ? true
      : alertDeliveryFilter === "failed"
        ? delivery.status.includes("failed")
        : delivery.status.includes("sent")
    if (!matchesStatus) {
      return false
    }
    const search = alertSearch.trim().toLowerCase()
    if (!search) {
      return true
    }
    return [
      delivery.organization_name || "",
      delivery.workspace_id,
      delivery.status,
      delivery.subject,
      delivery.error || "",
      ...delivery.recipients,
    ].some(value => value.toLowerCase().includes(search))
  })
  const visibleUsageEvents = (usageActivity?.recent_events || []).filter(event => {
    const search = usageSearch.trim().toLowerCase()
    if (!search) {
      return true
    }
    return [
      event.organization_name || "",
      event.workspace_id || "",
      event.actor_user_id || "",
      event.route,
      event.method,
      String(event.status_code),
    ].some(value => value.toLowerCase().includes(search))
  })
  const selectedOrganization = organizations.find(
    organization => organization.id === selectedOrganizationId
  )
  const selectedOrganizationIsClient =
    selectedOrganization?.plan === "client" ||
    selectedOrganization?.owner_user_id.includes(":client:") === true
  const planChart = ["free", "professional", "agency", "client"].map(plan => ({
    label: plan === "free" ? "Free" : plan[0].toUpperCase() + plan.slice(1),
    value: organizations.filter(organization => organization.plan === plan).length,
  }))
  const maxPlanCount = Math.max(...planChart.map(item => item.value), 1)
  const operationalChart = [
    {
      label: "Successful requests",
      value: usageActivity?.successful_events || 0,
      color: "bg-emerald-500",
    },
    {
      label: "Failed requests",
      value: usageActivity?.failed_events || 0,
      color: "bg-red-500",
    },
  ]
  const maxOperationalValue = Math.max(
    ...operationalChart.map(item => item.value),
    1
  )
  const aiChart = usageActivity?.ai_credit_segments || []
  const maxAiCredits = Math.max(
    ...aiChart.map(item => item.credits),
    1
  )
  const visiblePlatformUsers = platformUsers.filter((platformUser) => {
    const search = userSearch.trim().toLowerCase()
    if (!search) {
      return true
    }

    return [
      platformUser.clerk_user_id,
      ...platformUser.organization_names,
      ...platformUser.roles,
    ].some(value => value.toLowerCase().includes(search))
  })
  const canView = (permission: string) =>
    adminAccess?.full_access === true ||
    adminAccess?.permissions.includes(permission) === true

  if (!user) {
    return null
  }

  return (
    <main className="min-h-screen bg-gray-50 px-6 py-10 text-gray-900 sm:px-10">
      <div className="mx-auto flex max-w-6xl flex-col">
        <header className="flex flex-col gap-4 border-b border-gray-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">
              Internal operations
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              Platform Admin
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              Aggregate application health and adoption overview.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="text-right text-xs text-gray-500">
              <p className="font-medium text-gray-800">
                {user.fullName ?? "Platform owner"}
              </p>
              <p>{currentUserEmail ?? ""}</p>
            </div>
            <button
              type="button"
              onClick={() => void signOut({ redirectUrl: "/" })}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
            >
              <LogOut size={16} />
              Sign out
            </button>
            <UserButton />
            <button
              type="button"
              onClick={() => setRetryKey((value) => value + 1)}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>
        </header>

        {loading && (
          <div className="mt-8 rounded-xl border border-gray-200 bg-white px-5 py-4 text-sm text-gray-600">
            Loading platform overview...
          </div>
        )}

        {!loading && error && (
          <div className="mt-8 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {adminAccessLoading && !loading && (
          <div className="mt-8 rounded-xl border border-gray-200 bg-white px-5 py-4 text-sm text-gray-600">
            Loading platform admin permissions...
          </div>
        )}

        {!adminAccessLoading && adminAccessError && (
          <div className="mt-8 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
            {adminAccessError}
          </div>
        )}

        {!loading && !adminAccessLoading && !error && adminAccess?.allowed && (
          <>
            {overview && canView("overview") && (
              <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <MetricCard
                label="Organizations"
                value={overview.organization_count}
                icon={<Users size={20} />}
              />
              <MetricCard
                label="Members"
                value={overview.member_count}
                icon={<Users size={20} />}
              />
              <MetricCard
                label="Datasets"
                value={overview.dataset_count}
                icon={<Database size={20} />}
              />
              <MetricCard
                label="Decisions"
                value={overview.decision_count}
                icon={<FileCheck2 size={20} />}
              />
              <MetricCard
                label="Recommendations"
                value={overview.recommendation_count}
                icon={<BrainCircuit size={20} />}
              />
              <MetricCard
                label="Evaluated decisions"
                value={overview.evaluated_decision_count}
                icon={<Gauge size={20} />}
              />
              <MetricCard
                label="Recorded lessons"
                value={overview.lesson_count}
                icon={<FileCheck2 size={20} />}
              />
              <MetricCard
                label="Alert deliveries"
                value={overview.alert_delivery_count}
                icon={<Mail size={20} />}
              />
              <MetricCard
                label="Failed alert deliveries"
                value={overview.failed_alert_delivery_count}
                icon={<Mail size={20} />}
              />
              <MetricCard
                label="Usage events (30d)"
                value={overview.usage_event_count}
                icon={<Activity size={20} />}
              />
              </div>
            )}

            <section className={canView("overview") ? "mt-8 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm" : "hidden"}>
              <div className="border-b border-gray-200 px-5 py-4">
                <div className="flex items-center gap-3">
                  <BarChart3 className="text-blue-600" size={20} />
                  <div>
                    <h2 className="font-semibold">Platform analysis</h2>
                    <p className="mt-1 text-sm text-gray-500">
                      A working view of workspace mix, request health, and AI credit consumption for the selected usage period.
                    </p>
                  </div>
                </div>
              </div>
              <div className="grid gap-6 p-5 lg:grid-cols-3">
                <div>
                  <h3 className="text-sm font-medium text-gray-900">
                    Workspaces by plan
                  </h3>
                  <div className="mt-4 space-y-3">
                    {planChart.map(item => (
                      <div key={item.label}>
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="text-gray-600">{item.label}</span>
                          <span className="font-medium text-gray-900">{formatCount(item.value)}</span>
                        </div>
                        <div className="mt-1 h-2 rounded-full bg-gray-100">
                          <div
                            className="h-2 rounded-full bg-blue-500"
                            style={{ width: `${(item.value / maxPlanCount) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-medium text-gray-900">
                    Request health
                  </h3>
                  <div className="mt-4 space-y-3">
                    {operationalChart.map(item => (
                      <div key={item.label}>
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="text-gray-600">{item.label}</span>
                          <span className="font-medium text-gray-900">{formatCount(item.value)}</span>
                        </div>
                        <div className="mt-1 h-2 rounded-full bg-gray-100">
                          <div
                            className={`h-2 rounded-full ${item.color}`}
                            style={{ width: `${(item.value / maxOperationalValue) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-medium text-gray-900">
                    AI credits by customer type
                  </h3>
                  {aiChart.length === 0 ? (
                    <p className="mt-4 text-sm text-gray-500">
                      No AI credit activity for this period.
                    </p>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {aiChart.map(item => (
                        <div key={item.segment}>
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="capitalize text-gray-600">{item.segment}</span>
                            <span className="font-medium text-gray-900">{formatCount(item.credits)}</span>
                          </div>
                          <div className="mt-1 h-2 rounded-full bg-gray-100">
                            <div
                              className="h-2 rounded-full bg-amber-500"
                              style={{ width: `${(item.credits / maxAiCredits) * 100}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className={canView("workspaces") ? "mt-8 overflow-hidden rounded-xl border border-blue-200 bg-blue-50/40 shadow-sm" : "hidden"}>
              <div className="border-b border-blue-100 px-5 py-4">
                <div className="flex items-center gap-3">
                  <Building2 className="text-blue-600" size={20} />
                  <div>
                    <h2 className="font-semibold">Provision customer workspace</h2>
                    <p className="mt-1 text-sm text-gray-600">
                      Create a workspace for an evaluation customer, set access expiry, and prepare owner/member invitations.
                    </p>
                  </div>
                </div>
              </div>
              <form
                className="grid gap-4 p-5 md:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  void handleProvisionWorkspace()
                }}
              >
                <label className="text-xs font-medium text-gray-700">
                  Workspace name
                  <input
                    required
                    value={provisionForm.name}
                    onChange={(event) => setProvisionForm(currentForm => ({
                      ...currentForm,
                      name: event.target.value,
                    }))}
                    placeholder="Acme evaluation workspace"
                    className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900"
                  />
                </label>
                <label className="text-xs font-medium text-gray-700">
                  Workspace owner email
                  <input
                    required
                    type="email"
                    value={provisionForm.owner_email}
                    onChange={(event) => setProvisionForm(currentForm => ({
                      ...currentForm,
                      owner_email: event.target.value,
                    }))}
                    placeholder="owner@customer.com"
                    className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900"
                  />
                </label>
                <label className="text-xs font-medium text-gray-700">
                  Plan
                  <select
                    value={provisionForm.plan}
                    onChange={(event) => setProvisionForm(currentForm => ({
                      ...currentForm,
                      plan: event.target.value,
                    }))}
                    className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900"
                  >
                    <option value="free">Free evaluation</option>
                    <option value="professional">Professional</option>
                    <option value="agency">Agency</option>
                  </select>
                </label>
                <label className="text-xs font-medium text-gray-700">
                  Billing/access expiration
                  <span className="relative mt-1 block">
                    <CalendarDays
                      size={16}
                      className="pointer-events-none absolute left-3 top-2.5 text-gray-400"
                    />
                    <input
                      type="date"
                      value={provisionForm.billing_expires_at}
                      onChange={(event) => setProvisionForm(currentForm => ({
                        ...currentForm,
                        billing_expires_at: event.target.value,
                      }))}
                      className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm font-normal text-gray-900"
                    />
                  </span>
                </label>
                <label className="text-xs font-medium text-gray-700 md:col-span-2">
                  Member emails (optional)
                  <textarea
                    value={provisionForm.member_emails}
                    onChange={(event) => setProvisionForm(currentForm => ({
                      ...currentForm,
                      member_emails: event.target.value,
                    }))}
                    placeholder="One email per line or separated by commas"
                    rows={2}
                    className="mt-1 w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900"
                  />
                </label>
                <div className="flex flex-wrap items-center justify-between gap-3 md:col-span-2">
                  <div>
                    {provisionError && (
                      <p className="text-sm text-red-700">{provisionError}</p>
                    )}
                    {provisionMessage && (
                      <p className="text-sm text-green-700">{provisionMessage}</p>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={
                      provisioning ||
                      !provisionForm.name.trim() ||
                      !provisionForm.owner_email.trim()
                    }
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {provisioning ? "Creating workspace..." : "Create workspace"}
                  </button>
                </div>
              </form>
            </section>

            <section className={canView("credit_settings") ? "mt-8 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm" : "hidden"}>
              <div className="border-b border-gray-200 px-5 py-4">
                <h2 className="font-semibold">AI credit allocations</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Set the monthly credits included with each plan. These values are used immediately for new AI reservations and billing displays.
                </p>
              </div>

              {creditSettingsLoading && (
                <p className="px-5 py-4 text-sm text-gray-600">
                  Loading credit settings...
                </p>
              )}

              {!creditSettingsLoading && creditSettingsError && (
                <p className="px-5 py-4 text-sm text-red-700">
                  {creditSettingsError}
                </p>
              )}

              {!creditSettingsLoading && !creditSettingsError && creditSettings && (
                <form
                  className="space-y-5 p-5"
                  onSubmit={(event) => {
                    void handleSaveCreditSettings(event)
                  }}
                >
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {creditSettingFields.map((field) => (
                      <label
                        key={field.key}
                        className="text-xs font-medium text-gray-600"
                      >
                        {field.label}
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={creditForm[field.key]}
                          onChange={(event) => setCreditForm(currentForm => ({
                            ...currentForm,
                            [field.key]: event.target.value,
                          }))}
                          className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900"
                        />
                      </label>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
                    <p className="text-sm text-gray-500">
                      {creditSettings.source === "database"
                        ? "Using platform-saved allocations."
                        : "Using environment/default allocations until saved here."}
                    </p>
                    <button
                      type="submit"
                      disabled={creditSettingsSaving}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {creditSettingsSaving ? "Saving..." : "Save credit settings"}
                    </button>
                  </div>
                  {creditSettingsMessage && (
                    <p className="text-sm text-green-700">
                      {creditSettingsMessage}
                    </p>
                  )}
                </form>
              )}
            </section>

            <section className={canView("analytics") ? "mt-8 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm" : "hidden"}>
              <div className="flex flex-col gap-3 border-b border-gray-200 px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <Activity className="text-blue-600" size={20} />
                    <h2 className="font-semibold">Product usage activity</h2>
                  </div>
                  <p className="mt-1 text-sm text-gray-500">
                    All authenticated application activity across workspaces. Request bodies and credentials are never stored.
                  </p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-xs font-medium text-gray-600">
                    Search logs
                    <input
                      value={usageSearch}
                      onChange={(event) => setUsageSearch(event.target.value)}
                      placeholder="Route, workspace, user"
                      className="mt-1 block w-44 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900"
                    />
                  </label>
                  <label className="text-xs font-medium text-gray-600">
                    Period
                    <select
                      value={usagePeriodDays}
                      onChange={(event) => {
                        setUsageActivityLoading(true)
                        setUsagePeriodDays(event.target.value)
                      }}
                      className="mt-1 block rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900"
                    >
                      <option value="7">Last 7 days</option>
                      <option value="30">Last 30 days</option>
                      <option value="90">Last 90 days</option>
                      <option value="365">Last 12 months</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      void refreshUsageActivity()
                    }}
                    disabled={usageActivityLoading}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCw size={15} />
                    Refresh
                  </button>
                  <button
                    type="button"
                    disabled={!usageActivity || visibleUsageEvents.length === 0}
                    onClick={() => {
                      downloadCsv(
                        "decisionate-usage-activity.csv",
                        [
                          "id",
                          "created_at",
                          "workspace",
                          "workspace_id",
                          "actor_user_id",
                          "method",
                          "route",
                          "status_code",
                          "duration_ms",
                        ],
                        visibleUsageEvents.map(event => [
                          event.id,
                          event.created_at,
                          event.organization_name,
                          event.workspace_id,
                          event.actor_user_id,
                          event.method,
                          event.route,
                          event.status_code,
                          event.duration_ms,
                        ])
                      )
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Download size={15} />
                    CSV
                  </button>
                </div>
              </div>

              {usageActivityLoading && (
                <p className="px-5 py-4 text-sm text-gray-600">
                  Loading usage activity...
                </p>
              )}

              {!usageActivityLoading && usageActivityError && (
                <p className="px-5 py-4 text-sm text-red-700">
                  {usageActivityError}
                </p>
              )}

              {!usageActivityLoading && !usageActivityError && usageActivity && (
                <>
                  <div className="grid gap-3 border-b border-gray-200 p-5 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <p className="text-xs text-gray-500">Events</p>
                      <p className="mt-1 text-xl font-semibold">{formatCount(usageActivity.total_events)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Successful</p>
                      <p className="mt-1 text-xl font-semibold text-green-700">{formatCount(usageActivity.successful_events)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Failed</p>
                      <p className="mt-1 text-xl font-semibold text-red-700">{formatCount(usageActivity.failed_events)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Active users</p>
                      <p className="mt-1 text-xl font-semibold">{formatCount(usageActivity.active_users)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Avg response</p>
                      <p className="mt-1 text-xl font-semibold">{formatCount(usageActivity.average_duration_ms)} ms</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Active workspaces</p>
                      <p className="mt-1 text-xl font-semibold">{formatCount(usageActivity.active_workspaces)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">AI requests</p>
                      <p className="mt-1 text-xl font-semibold">{formatCount(usageActivity.ai_requests)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">AI credits</p>
                      <p className="mt-1 text-xl font-semibold">{formatCount(usageActivity.ai_credits)}</p>
                      <p className="mt-1 text-xs text-gray-500">{formatCount(usageActivity.ai_tokens)} tokens</p>
                    </div>
                  </div>

                  <div className="border-b border-gray-200 p-5">
                    <div className="flex items-start gap-3">
                      <Coins className="mt-0.5 text-blue-600" size={20} />
                      <div>
                        <h3 className="font-medium text-gray-900">
                          AI credit consumption
                        </h3>
                        <p className="mt-1 text-sm text-gray-500">
                          Actual completed AI charges grouped by customer type, user, and workspace.
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-6 lg:grid-cols-2">
                      <div>
                        <h4 className="text-sm font-medium text-gray-900">
                          By customer type
                        </h4>
                        <div className="mt-3 overflow-x-auto">
                          <table className="min-w-full text-left text-sm">
                            <thead className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                              <tr>
                                <th className="py-2 pr-3 font-medium">Type</th>
                                <th className="py-2 pr-3 font-medium">Credits</th>
                                <th className="py-2 pr-3 font-medium">Users</th>
                                <th className="py-2 font-medium">Workspaces</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {usageActivity.ai_credit_segments.map((segment) => (
                                <tr key={segment.segment}>
                                  <td className="py-2 pr-3 font-medium text-gray-800">
                                    {segment.segment}
                                  </td>
                                  <td className="py-2 pr-3 text-gray-700">
                                    {formatCount(segment.credits)}
                                  </td>
                                  <td className="py-2 pr-3 text-gray-700">
                                    {formatCount(segment.active_users)}
                                  </td>
                                  <td className="py-2 text-gray-700">
                                    {formatCount(segment.workspaces)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div>
                        <h4 className="text-sm font-medium text-gray-900">
                          Highest-consuming users
                        </h4>
                        {usageActivity.ai_credit_users.length === 0 ? (
                          <p className="mt-3 text-sm text-gray-500">
                            No completed AI charges recorded for this period.
                          </p>
                        ) : (
                          <div className="mt-3 max-h-64 overflow-auto rounded-lg border border-gray-200">
                            <table className="min-w-full text-left text-sm">
                              <thead className="sticky top-0 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                                <tr>
                                  <th className="px-3 py-2 font-medium">User</th>
                                  <th className="px-3 py-2 font-medium">Type</th>
                                  <th className="px-3 py-2 font-medium">Credits</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {usageActivity.ai_credit_users.map((entry) => (
                                  <tr key={`${entry.segment}-${entry.user_id}`}>
                                    <td
                                      className="max-w-40 truncate px-3 py-2 text-xs text-gray-700"
                                      title={entry.user_id}
                                    >
                                      {entry.user_id}
                                      {!entry.attributed && (
                                        <span className="block text-[10px] text-gray-400">
                                          Workspace-attributed activity
                                        </span>
                                      )}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600">
                                      {entry.segment}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-2 text-xs font-medium text-gray-800">
                                      {formatCount(entry.credits)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-6">
                      <h4 className="text-sm font-medium text-gray-900">
                        Highest-consuming workspaces and clients
                      </h4>
                      {usageActivity.ai_credit_workspaces.length === 0 ? (
                        <p className="mt-3 text-sm text-gray-500">
                          No workspace AI consumption recorded for this period.
                        </p>
                      ) : (
                        <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200">
                          <table className="min-w-full text-left text-sm">
                            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                              <tr>
                                <th className="px-3 py-2 font-medium">Workspace</th>
                                <th className="px-3 py-2 font-medium">Type</th>
                                <th className="px-3 py-2 font-medium">Credits</th>
                                <th className="px-3 py-2 font-medium">Users</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {usageActivity.ai_credit_workspaces.map((workspace) => (
                                <tr key={workspace.workspace_id}>
                                  <td
                                    className="max-w-64 truncate px-3 py-2 text-xs text-gray-700"
                                    title={workspace.workspace_id}
                                  >
                                    {workspace.organization_name || workspace.workspace_id}
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600">
                                    {workspace.segment}
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-2 text-xs font-medium text-gray-800">
                                    {formatCount(workspace.credits)}
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600">
                                    {formatCount(workspace.active_users)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                    <div>
                      <h3 className="font-medium text-gray-900">Most-used product routes</h3>
                      {usageActivity.top_routes.length === 0 ? (
                        <p className="mt-3 text-sm text-gray-500">No usage recorded for this period.</p>
                      ) : (
                        <div className="mt-3 overflow-x-auto">
                          <table className="min-w-full text-left text-sm">
                            <thead className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                              <tr>
                                <th className="py-2 pr-3 font-medium">Route</th>
                                <th className="py-2 pr-3 font-medium">Events</th>
                                <th className="py-2 font-medium">Failed</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {usageActivity.top_routes.map((route) => (
                                <tr key={`${route.method}-${route.route}`}>
                                  <td className="py-2 pr-3 font-mono text-xs text-gray-700">
                                    {route.method} {route.route}
                                  </td>
                                  <td className="py-2 pr-3 text-gray-700">{formatCount(route.event_count)}</td>
                                  <td className={`py-2 ${route.failed_count ? "text-red-700" : "text-gray-500"}`}>
                                    {formatCount(route.failed_count)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    <div>
                      <h3 className="font-medium text-gray-900">Recent activity</h3>
                      {visibleUsageEvents.length === 0 ? (
                        <p className="mt-3 text-sm text-gray-500">No usage recorded for this period.</p>
                      ) : (
                        <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-gray-200">
                          <table className="min-w-full text-left text-sm">
                            <thead className="sticky top-0 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                              <tr>
                                <th className="px-3 py-2 font-medium">When</th>
                                <th className="px-3 py-2 font-medium">Workspace</th>
                                <th className="px-3 py-2 font-medium">Activity</th>
                                <th className="px-3 py-2 font-medium">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {visibleUsageEvents.map((event) => (
                                <tr key={event.id}>
                                  <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">
                                    {event.created_at ? new Date(event.created_at).toLocaleString() : "Unknown"}
                                  </td>
                                  <td className="max-w-32 truncate px-3 py-2 text-xs text-gray-700" title={event.workspace_id || undefined}>
                                    {event.organization_name || event.workspace_id || "Unknown"}
                                    <span className="block truncate text-[10px] text-gray-400" title={event.actor_user_id || undefined}>
                                      {event.actor_user_id || "Unknown actor"}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 font-mono text-xs text-gray-700">
                                    {event.method} {event.route}
                                  </td>
                                  <td className={`whitespace-nowrap px-3 py-2 text-xs font-medium ${event.status_code >= 400 ? "text-red-700" : "text-green-700"}`}>
                                    {event.status_code} · {event.duration_ms} ms
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </section>

            {overview && canView("overview") && (
            <div className="mt-8 grid gap-4 lg:grid-cols-2">
              <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <BrainCircuit className="text-blue-600" size={20} />
                  <h2 className="font-semibold">AI service</h2>
                </div>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-gray-500">Provider</dt>
                    <dd className="mt-1 font-medium">
                      {overview.ai_status.provider}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Model</dt>
                    <dd className="mt-1 font-medium">
                      {overview.ai_status.model || "Not configured"}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-gray-500">Status</dt>
                    <dd className={`mt-1 font-medium ${overview.ai_status.configured ? "text-green-700" : "text-amber-700"}`}>
                      {overview.ai_status.configured ? "Configured" : "Rules fallback active"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Recommendations evaluated</dt>
                    <dd className="mt-1 font-medium">
                      {formatCount(overview.evaluated_recommendation_count)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Successful recommendations</dt>
                    <dd className="mt-1 font-medium">
                      {formatCount(overview.successful_recommendation_count)}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-gray-500">Recommendation success rate</dt>
                    <dd className="mt-1 font-medium">
                      {overview.recommendation_success_rate === null ||
                      overview.recommendation_success_rate === undefined
                        ? "Not enough classified outcomes"
                        : `${overview.recommendation_success_rate.toLocaleString()}%`}
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <Mail className="text-blue-600" size={20} />
                  <h2 className="font-semibold">Alert service</h2>
                </div>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-gray-500">Decisionate SMTP</dt>
                    <dd className={`mt-1 font-medium ${overview.alert_status?.server_smtp_configured ? "text-green-700" : "text-amber-700"}`}>
                      {overview.alert_status?.server_smtp_configured ? "Configured" : "Not configured"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Scheduler secret</dt>
                    <dd className={`mt-1 font-medium ${overview.alert_status?.scheduler_configured ? "text-green-700" : "text-amber-700"}`}>
                      {overview.alert_status?.scheduler_configured ? "Configured" : "Not configured"}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-xs text-gray-500">
                      Platform email settings are managed below. Workspace-specific SMTP settings remain available for customer alert overrides.
                    </p>
                  </div>
                </dl>
              </section>
            </div>
            )}

            <section className={canView("email_settings") ? "mt-8 rounded-xl border border-gray-200 bg-white p-5 shadow-sm" : "hidden"}>
              <div className="flex items-start gap-3">
                <Mail className="mt-0.5 text-blue-600" size={20} />
                <div>
                  <h2 className="font-semibold">Decisionate email delivery</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    Configure the SMTP account used for Decisionate system email,
                    including support, signup, subscription, and AI credit messages.
                    Customer workspace SMTP settings remain separate.
                  </p>
                </div>
              </div>

              {emailSettingsLoading && (
                <p className="mt-5 text-sm text-gray-600">
                  Loading email settings...
                </p>
              )}

              {!emailSettingsLoading && emailSettingsError && (
                <p className="mt-5 text-sm text-red-700">
                  {emailSettingsError}
                </p>
              )}

              {!emailSettingsLoading && !emailSettingsError && emailSettings && (
                <form
                  className="mt-5 space-y-4"
                  onSubmit={(event) => {
                    void handleSaveEmailSettings(event)
                  }}
                >
                  <div className="grid gap-4 md:grid-cols-[12rem_minmax(0,1fr)]">
                    <label className="text-xs font-medium text-gray-600">
                      Delivery provider
                      <select
                        value={emailForm.provider}
                        onChange={(event) => setEmailForm(currentForm => ({
                          ...currentForm,
                          provider: event.target.value as "smtp" | "resend",
                        }))}
                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900"
                      >
                        <option value="resend">Resend</option>
                        <option value="smtp">SMTP</option>
                      </select>
                    </label>
                    <p className="self-end text-xs text-gray-500">
                      Resend is recommended for Decisionate-owned system mail.
                      Workspace SMTP overrides remain available for customer reports.
                    </p>
                  </div>

                  {emailForm.provider === "resend" && (
                    <div className="grid gap-4 md:grid-cols-3">
                      <label className="text-xs font-medium text-gray-600">
                        Resend API key
                        <input
                          type="password"
                          value={emailForm.resend_api_key}
                          onChange={(event) => setEmailForm(currentForm => ({
                            ...currentForm,
                            resend_api_key: event.target.value,
                            clear_resend_api_key: false,
                          }))}
                          placeholder={emailSettings.resend_api_key_set ? "Saved key" : "re_..."}
                          className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900"
                        />
                      </label>
                      <label className="text-xs font-medium text-gray-600">
                        Resend sender email
                        <input
                          type="email"
                          value={emailForm.resend_from_email}
                          onChange={(event) => setEmailForm(currentForm => ({
                            ...currentForm,
                            resend_from_email: event.target.value,
                          }))}
                          placeholder="no-reply@decisionate.ca"
                          className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900"
                        />
                      </label>
                      <label className="text-xs font-medium text-gray-600">
                        Resend sender name
                        <input
                          value={emailForm.resend_from_name}
                          onChange={(event) => setEmailForm(currentForm => ({
                            ...currentForm,
                            resend_from_name: event.target.value,
                          }))}
                          className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900"
                        />
                      </label>
                    </div>
                  )}

                  <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_8rem]">
                    <label className="text-xs font-medium text-gray-600">
                      SMTP host
                      <input
                        value={emailForm.smtp_host}
                        onChange={(event) => setEmailForm(currentForm => ({
                          ...currentForm,
                          smtp_host: event.target.value,
                        }))}
                        placeholder="smtp.example.com"
                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900"
                      />
                    </label>
                    <label className="text-xs font-medium text-gray-600">
                      Port
                      <input
                        type="number"
                        min="1"
                        max="65535"
                        value={emailForm.smtp_port}
                        onChange={(event) => setEmailForm(currentForm => ({
                          ...currentForm,
                          smtp_port: event.target.value,
                        }))}
                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900"
                      />
                    </label>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="text-xs font-medium text-gray-600">
                      SMTP username
                      <input
                        value={emailForm.smtp_username}
                        onChange={(event) => setEmailForm(currentForm => ({
                          ...currentForm,
                          smtp_username: event.target.value,
                        }))}
                        autoComplete="username"
                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900"
                      />
                    </label>
                    <label className="text-xs font-medium text-gray-600">
                      SMTP password
                      <input
                        type="password"
                        value={emailForm.smtp_password}
                        onChange={(event) => setEmailForm(currentForm => ({
                          ...currentForm,
                          smtp_password: event.target.value,
                          clear_password: false,
                        }))}
                        autoComplete="new-password"
                        placeholder={emailSettings.smtp_password_set ? "Saved password" : "Enter password"}
                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900"
                      />
                    </label>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="text-xs font-medium text-gray-600">
                      Sender email
                      <input
                        type="email"
                        value={emailForm.smtp_from_email}
                        onChange={(event) => setEmailForm(currentForm => ({
                          ...currentForm,
                          smtp_from_email: event.target.value,
                        }))}
                        placeholder="no-reply@decisionate.ca"
                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900"
                      />
                    </label>
                    <label className="text-xs font-medium text-gray-600">
                      Sender name
                      <input
                        value={emailForm.smtp_from_name}
                        onChange={(event) => setEmailForm(currentForm => ({
                          ...currentForm,
                          smtp_from_name: event.target.value,
                        }))}
                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900"
                      />
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center gap-5 text-sm text-gray-700">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={emailForm.smtp_use_tls}
                        onChange={(event) => setEmailForm(currentForm => ({
                          ...currentForm,
                          smtp_use_tls: event.target.checked,
                          smtp_use_ssl: event.target.checked ? false : currentForm.smtp_use_ssl,
                        }))}
                        className="rounded border-gray-300 text-blue-600"
                      />
                      Use TLS
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={emailForm.smtp_use_ssl}
                        onChange={(event) => setEmailForm(currentForm => ({
                          ...currentForm,
                          smtp_use_ssl: event.target.checked,
                          smtp_use_tls: event.target.checked ? false : currentForm.smtp_use_tls,
                        }))}
                        className="rounded border-gray-300 text-blue-600"
                      />
                      Use SSL
                    </label>
                    {emailSettings.smtp_password_set && (
                      <label className="inline-flex items-center gap-2 text-gray-500">
                        <input
                          type="checkbox"
                          checked={emailForm.clear_password}
                          onChange={(event) => setEmailForm(currentForm => ({
                            ...currentForm,
                            clear_password: event.target.checked,
                            smtp_password: event.target.checked ? "" : currentForm.smtp_password,
                          }))}
                          className="rounded border-gray-300 text-blue-600"
                        />
                        Clear saved password
                      </label>
                    )}
                    {emailSettings.resend_api_key_set && (
                      <label className="inline-flex items-center gap-2 text-gray-500">
                        <input
                          type="checkbox"
                          checked={emailForm.clear_resend_api_key}
                          onChange={(event) => setEmailForm(currentForm => ({
                            ...currentForm,
                            clear_resend_api_key: event.target.checked,
                            resend_api_key: event.target.checked ? "" : currentForm.resend_api_key,
                          }))}
                          className="rounded border-gray-300 text-blue-600"
                        />
                        Clear saved Resend key
                      </label>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
                    <p className={`text-sm ${emailSettings.configured ? "text-green-700" : "text-amber-700"}`}>
                      {emailSettings.configured
                        ? `Configured via ${emailSettings.source === "database" ? "platform settings" : "environment fallback"}.`
                        : "Not configured. Set the selected provider credentials and sender before sending system email."}
                    </p>
                    <button
                      type="submit"
                      disabled={emailSettingsSaving}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {emailSettingsSaving ? "Saving..." : "Save email settings"}
                    </button>
                  </div>
                  {emailSettingsMessage && (
                    <p className="text-sm text-green-700">
                      {emailSettingsMessage}
                    </p>
                  )}
                </form>
              )}
            </section>

            <section className={canView("workspaces") ? "order-10 mt-8 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm" : "hidden"}>
              <div className="border-b border-gray-200 px-5 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="font-semibold">Workspaces</h2>
                    <p className="mt-1 text-sm text-gray-500">
                      All customer workspaces, their activity, and individual deletion controls. Deleting an agency workspace also deletes its managed client workspaces and their data.
                    </p>
                  </div>
                  <label className="text-xs font-medium text-gray-600">
                    Search
                    <input
                      value={organizationSearch}
                      onChange={(event) => setOrganizationSearch(event.target.value)}
                      placeholder="Name or owner email"
                      className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 sm:w-56"
                    />
                  </label>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-5 py-3 font-medium">Organization</th>
                      <th className="px-5 py-3 font-medium">Owner</th>
                      <th className="px-5 py-3 font-medium">Plan</th>
                      <th className="px-5 py-3 font-medium">Expires</th>
                      <th className="px-5 py-3 font-medium">Members</th>
                      <th className="px-5 py-3 font-medium">Datasets</th>
                      <th className="px-5 py-3 font-medium">Decisions</th>
                      <th className="px-5 py-3 font-medium">Evaluated</th>
                      <th className="px-5 py-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {visibleOrganizations.map((organization) => (
                      <Fragment key={organization.id}>
                      <tr>
                        <td className="whitespace-nowrap px-5 py-3 font-medium text-gray-900">
                          {organization.name}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-gray-500">
                          {organization.owner_email || organization.owner_user_id}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 capitalize text-gray-700">
                          {organization.plan}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-gray-500">
                          {organization.billing_expires_at
                            ? new Date(organization.billing_expires_at).toLocaleDateString()
                            : "No expiry"}
                        </td>
                        <td className="px-5 py-3 text-gray-700">
                          {formatCount(organization.member_count)}
                        </td>
                        <td className="px-5 py-3 text-gray-700">
                          {formatCount(organization.dataset_count)}
                        </td>
                        <td className="px-5 py-3 text-gray-700">
                          {formatCount(organization.decision_count)}
                        </td>
                        <td className="px-5 py-3 text-gray-700">
                          {formatCount(organization.evaluated_decision_count)}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                void handleViewMembers(organization.id)
                              }}
                              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
                            >
                              View members
                            </button>
                            {deleteConfirmationId === organization.id ? (
                              <>
                                <input
                                  aria-label={`Deletion confirmation for ${organization.name}`}
                                  value={deleteConfirmationText}
                                  onChange={(event) => setDeleteConfirmationText(event.target.value)}
                                  placeholder="Type DELETE WORKSPACE"
                                  className="w-44 rounded-lg border border-red-300 px-2.5 py-1.5 text-xs text-gray-900"
                                />
                                <button
                                  type="button"
                                  disabled={
                                    destructiveActionId ===
                                      `organization:${organization.id}` ||
                                    deleteConfirmationText.trim() !== "DELETE WORKSPACE"
                                  }
                                  onClick={() => {
                                    void handleDeleteOrganization(organization)
                                  }}
                                  className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <Trash2 size={13} />
                                  {destructiveActionId ===
                                  `organization:${organization.id}`
                                    ? "Deleting..."
                                    : "Confirm delete"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDeleteConfirmationId(null)
                                    setDeleteConfirmationText("")
                                    setDestructiveError("")
                                    setDestructiveMessage("")
                                    setDeleteModalOrganization(null)
                                  }}
                                  className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                title="Delete workspace"
                                onClick={() => {
                                  void handleDeleteOrganization(organization)
                                }}
                                className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-50"
                              >
                                <Trash2 size={13} />
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {selectedOrganizationId === organization.id && (
                        <tr>
                          <td
                            colSpan={9}
                            className="border-t border-blue-100 bg-blue-50/50 px-5 py-3"
                          >
                            {membersLoading && (
                              <p className="text-sm text-gray-600">
                                Loading workspace members...
                              </p>
                            )}
                            {!membersLoading && membersError && (
                              <p className="text-sm font-medium text-red-700">
                                {membersError}
                              </p>
                            )}
                            {!membersLoading && !membersError && (
                              <div className="space-y-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                  Workspace members ({members.length})
                                </p>
                                {members.length === 0 ? (
                                  <p className="text-sm text-gray-600">
                                    No members are currently recorded for this workspace.
                                  </p>
                                ) : (
                                  <div className="flex flex-wrap gap-2">
                                    {members.map((member) => (
                                      <span
                                        key={member.id}
                                        className="rounded-full border border-blue-100 bg-white px-3 py-1 text-xs text-gray-700"
                                      >
                                        {member.email || member.clerk_user_id} · {member.role}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                {invites.length > 0 && (
                                  <p className="text-xs text-gray-500">
                                    Pending invites: {invites.length}
                                  </p>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

            {visibleOrganizations.length === 0 && (
                <p className="px-5 py-4 text-sm text-gray-500">
                  {organizationSearch.trim()
                    ? "No workspaces match this search."
                    : "No workspaces are available."}
                </p>
              )}
              {destructiveError && (
                <p className="px-5 py-4 text-sm font-medium text-red-700">
                  {destructiveError}
                </p>
              )}
              {destructiveMessage && (
                <p className="px-5 py-4 text-sm font-medium text-emerald-700">
                  {destructiveMessage}
                </p>
              )}
            </section>

            <section className={canView("users") ? "mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm" : "hidden"}>
              <div className="flex flex-col gap-3 border-b border-gray-200 px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="font-semibold">Users</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    Workspace memberships across the application.
                  </p>
                </div>
                <label className="text-xs font-medium text-gray-600">
                  Search
                  <input
                    value={userSearch}
                    onChange={(event) => setUserSearch(event.target.value)}
                    placeholder="User, workspace, or role"
                    className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900 sm:w-64"
                  />
                </label>
              </div>

              {adminAccess?.full_access && (
                <div className="border-b border-gray-200 bg-amber-50/60 px-5 py-4">
                  <div className="flex items-start gap-3">
                    <Users className="mt-0.5 text-amber-700" size={18} />
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-gray-900">
                        Add limited platform admins
                      </h3>
                      <p className="mt-1 text-sm text-gray-600">
                        Enter one email or internal/provider reference per line,
                        or separate multiple users with commas. The selected
                        admin cards will apply to everyone listed.
                      </p>
                      <form
                        className="mt-4 space-y-4"
                        onSubmit={(event) => {
                          event.preventDefault()
                          void handleAddPlatformAdministrator()
                        }}
                      >
                        <label className="block text-xs font-medium text-gray-700">
                          User emails or references
                          <textarea
                            required
                            rows={3}
                            value={adminTargetReference}
                            onChange={(event) => {
                              setAdminTargetReference(event.target.value)
                              setAdminGrantError("")
                            }}
                            placeholder={'admin@company.com\nsecond-admin@company.com'}
                            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900"
                          />
                        </label>
                        <div>
                          <p className="text-xs font-medium text-gray-700">
                            Cards this admin can access
                          </p>
                          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {adminAccess.available_permissions.map((permission) => (
                              <label
                                key={permission.key}
                                className="flex items-start gap-2 rounded-lg border border-amber-100 bg-white px-3 py-2 text-sm text-gray-700"
                              >
                                <input
                                  type="checkbox"
                                  checked={adminPermissionDraft.includes(permission.key)}
                                  onChange={(event) => {
                                    setAdminPermissionDraft(current =>
                                      event.target.checked
                                        ? [...current, permission.key]
                                        : current.filter(
                                            key => key !== permission.key
                                          )
                                    )
                                  }}
                                  className="mt-0.5 rounded border-gray-300 text-blue-600"
                                />
                                <span>{permission.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="text-sm">
                            {adminGrantError && (
                              <p className="text-red-700">{adminGrantError}</p>
                            )}
                            {adminGrantMessage && (
                              <p className="text-green-700">{adminGrantMessage}</p>
                            )}
                          </div>
                          <button
                            type="submit"
                            disabled={
                              adminGranting ||
                              adminTargetReference.trim().length === 0 ||
                              adminPermissionDraft.length === 0
                            }
                            className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {adminGranting ? "Saving access..." : "Add/update admin users"}
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                </div>
              )}

              <div className="border-b border-gray-200 bg-blue-50 px-5 py-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <label className="flex-1 text-xs font-medium text-gray-700">
                    Link current sign-in to an internal account
                    <input
                      value={identityLinkTarget}
                      onChange={(event) => {
                        setIdentityLinkTarget(event.target.value)
                        setIdentityLinkError("")
                      }}
                      placeholder="usr_..."
                      className="mt-1 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-normal text-gray-900"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={identityLinking || !identityLinkTarget.trim()}
                    onClick={() => {
                      void handleLinkCurrentIdentity()
                    }}
                    className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {identityLinking ? "Linking..." : "Link account"}
                  </button>
                </div>
                <p className="mt-2 text-xs text-blue-900">
                  This changes only the sign-in alias. Datasets, decisions, and workspace ownership stay on the internal account.
                </p>
                {identityLinkError && (
                  <p className="mt-2 text-sm text-red-700">
                    {identityLinkError}
                  </p>
                )}
              </div>

              {platformUsersLoading && (
                <p className="px-5 py-4 text-sm text-gray-600">
                  Loading users...
                </p>
              )}

              {!platformUsersLoading && platformUsersError && (
                <p className="px-5 py-4 text-sm text-red-700">
                  {platformUsersError}
                </p>
              )}

              {!platformUsersLoading && !platformUsersError && visiblePlatformUsers.length === 0 && (
                <p className="px-5 py-4 text-sm text-gray-500">
                  {platformUsers.length === 0
                    ? "No users are available."
                    : "No users match this search."}
                </p>
              )}

              {!platformUsersLoading && !platformUsersError && visiblePlatformUsers.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
                    <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-5 py-3 font-medium">Internal user</th>
                        <th className="px-5 py-3 font-medium">Email</th>
                        <th className="px-5 py-3 font-medium">Workspaces</th>
                        <th className="px-5 py-3 font-medium">Roles and admin cards</th>
                        <th className="px-5 py-3 font-medium">Organizations</th>
                        <th className="px-5 py-3 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {visiblePlatformUsers.map((platformUser) => (
                        <tr key={platformUser.clerk_user_id}>
                          <td className="whitespace-nowrap px-5 py-3 font-medium text-gray-900">
                            {platformUser.clerk_user_id}
                          </td>
                          <td className="px-5 py-3 text-gray-500">
                            {platformUser.email || "-"}
                          </td>
                          <td className="px-5 py-3 text-gray-700">
                            {platformUser.organization_count}
                          </td>
                          <td className="px-5 py-3 capitalize text-gray-700">
                            {platformUser.roles.join(", ")}
                            {platformUser.platform_admin && (
                              <span className="mt-1 block text-xs normal-case text-gray-500">
                                {platformUser.platform_admin_permissions?.length
                                  ? platformUser.platform_admin_permissions.join(", ")
                                  : "All platform admin cards"}
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-gray-500">
                            {platformUser.organization_names.join(", ")}
                          </td>
                          <td className="px-5 py-3">
                            {platformUser.protected ? (
                              <span className="text-xs font-medium text-gray-500">
                                Protected
                              </span>
                            ) : (
                              <button
                                type="button"
                                title="Delete user"
                                disabled={
                                  destructiveActionId ===
                                  `user:${platformUser.clerk_user_id}`
                                }
                                onClick={() => {
                                  void handleDeleteUser(platformUser)
                                }}
                                className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <Trash2 size={13} />
                                {destructiveActionId ===
                                `user:${platformUser.clerk_user_id}`
                                  ? "Deleting..."
                                  : "Delete"}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className={canView("audit") ? "mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm" : "hidden"}>
              <div className="flex flex-col gap-3 border-b border-gray-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-semibold">Admin audit history</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    Membership and invitation changes made by platform admins.
                  </p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-xs font-medium text-gray-600">
                    Search logs
                    <input
                      value={auditSearch}
                      onChange={(event) => setAuditSearch(event.target.value)}
                      placeholder="Action, email, workspace"
                      className="mt-1 block w-48 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      void refreshAuditEvents()
                    }}
                    disabled={auditLoading}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCw size={15} />
                    Refresh
                  </button>
                  <button
                    type="button"
                    disabled={visibleAuditEvents.length === 0}
                    onClick={() => {
                      downloadCsv(
                        "decisionate-audit-events.csv",
                        [
                          "id",
                          "created_at",
                          "action",
                          "organization_id",
                          "target_email",
                          "target_user_id",
                          "admin_user_id",
                          "details",
                        ],
                        visibleAuditEvents.map(event => [
                          event.id,
                          event.created_at,
                          event.action,
                          event.organization_id,
                          event.target_email,
                          event.target_user_id,
                          event.admin_user_id,
                          event.details,
                        ])
                      )
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Download size={15} />
                    CSV
                  </button>
                </div>
              </div>

              {auditLoading && (
                <p className="px-5 py-4 text-sm text-gray-600">
                  Loading audit history...
                </p>
              )}

              {!auditLoading && auditError && (
                <p className="px-5 py-4 text-sm text-red-700">
                  {auditError}
                </p>
              )}

              {!auditLoading && !auditError && visibleAuditEvents.length === 0 && (
                <p className="px-5 py-4 text-sm text-gray-500">
                  {auditEvents.length === 0
                    ? "No platform-admin changes recorded yet."
                    : "No audit events match this search."}
                </p>
              )}

              {!auditLoading && !auditError && visibleAuditEvents.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
                    <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-5 py-3 font-medium">When</th>
                        <th className="px-5 py-3 font-medium">Action</th>
                        <th className="px-5 py-3 font-medium">Workspace</th>
                        <th className="px-5 py-3 font-medium">Target</th>
                        <th className="px-5 py-3 font-medium">Admin</th>
                        <th className="px-5 py-3 font-medium">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {visibleAuditEvents.map((event) => (
                        <tr key={event.id}>
                          <td className="whitespace-nowrap px-5 py-3 text-gray-500">
                            {event.created_at
                              ? new Date(event.created_at).toLocaleString()
                              : "Unknown"}
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 font-medium capitalize text-gray-900">
                            {event.action.replaceAll("_", " ")}
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 text-gray-700">
                            {event.organization_id
                              ? organizations.find(
                                  organization =>
                                    organization.id === event.organization_id
                                )?.name || `#${event.organization_id}`
                              : "Platform"}
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 text-gray-700">
                            {event.target_email || event.target_user_id || "None"}
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 text-gray-500">
                            {event.admin_user_id}
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 text-gray-500">
                            {event.details || "None"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className={canView("alerts") ? "mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm" : "hidden"}>
              <div className="flex flex-col gap-3 border-b border-gray-200 px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="font-semibold">Alert delivery operations</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    Recent customer workspace delivery attempts and failures.
                  </p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-xs font-medium text-gray-600">
                    Search logs
                    <input
                      value={alertSearch}
                      onChange={(event) => setAlertSearch(event.target.value)}
                      placeholder="Workspace, recipient, status"
                      className="mt-1 block w-48 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900"
                    />
                  </label>
                  <label className="text-xs font-medium text-gray-600">
                    Show
                    <select
                      value={alertDeliveryFilter}
                      onChange={(event) => {
                        setAlertDeliveryFilter(
                          event.target.value as "all" | "failed" | "sent"
                        )
                      }}
                      className="mt-1 block rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900"
                    >
                      <option value="all">All attempts</option>
                      <option value="failed">Failures</option>
                      <option value="sent">Successful sends</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={visibleAlertDeliveries.length === 0}
                    onClick={() => {
                      downloadCsv(
                        "decisionate-alert-deliveries.csv",
                        [
                          "id",
                          "attempted_at",
                          "workspace",
                          "workspace_id",
                          "status",
                          "recipients",
                          "subject",
                          "delivered_count",
                          "metrics_count",
                          "error",
                        ],
                        visibleAlertDeliveries.map(delivery => [
                          delivery.id,
                          delivery.attempted_at,
                          delivery.organization_name,
                          delivery.workspace_id,
                          delivery.status,
                          delivery.recipients.join("; "),
                          delivery.subject,
                          delivery.delivered_count,
                          delivery.metrics_count,
                          delivery.error,
                        ])
                      )
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Download size={15} />
                    CSV
                  </button>
                </div>
              </div>

              {alertDeliveriesLoading && (
                <p className="px-5 py-4 text-sm text-gray-600">
                  Loading alert delivery history...
                </p>
              )}

              {!alertDeliveriesLoading && alertDeliveriesError && (
                <p className="px-5 py-4 text-sm text-red-700">
                  {alertDeliveriesError}
                </p>
              )}

              {!alertDeliveriesLoading && !alertDeliveriesError && visibleAlertDeliveries.length === 0 && (
                <p className="px-5 py-4 text-sm text-gray-500">
                  {alertDeliveries.length === 0
                    ? "No alert delivery attempts recorded yet."
                    : "No attempts match this search or filter."}
                </p>
              )}

              {!alertDeliveriesLoading && !alertDeliveriesError && visibleAlertDeliveries.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
                    <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-5 py-3 font-medium">When</th>
                        <th className="px-5 py-3 font-medium">Workspace</th>
                        <th className="px-5 py-3 font-medium">Status</th>
                        <th className="px-5 py-3 font-medium">Recipients</th>
                        <th className="px-5 py-3 font-medium">Detail</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {visibleAlertDeliveries.map((delivery) => (
                        <tr key={delivery.id}>
                          <td className="whitespace-nowrap px-5 py-3 text-gray-500">
                            {delivery.attempted_at
                              ? new Date(delivery.attempted_at).toLocaleString()
                              : "Unknown"}
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 text-gray-700">
                            {delivery.organization_name || delivery.workspace_id}
                          </td>
                          <td className="whitespace-nowrap px-5 py-3">
                            <span
                              className={
                                delivery.status.includes("failed")
                                  ? "font-medium text-red-700"
                                  : "font-medium text-green-700"
                              }
                            >
                              {delivery.status.replaceAll("_", " ")}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 text-gray-700">
                            {delivery.delivered_count}/{delivery.recipients.length}
                          </td>
                          <td className="max-w-md px-5 py-3 text-gray-500">
                            {delivery.error || delivery.subject || "None"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {selectedOrganizationId !== null && (
              <section className={canView("workspaces") ? "order-20 mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm" : "hidden"}>
                <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
                  <div>
                    <h2 className="font-semibold">
                      Members for {organizations.find(
                        organization => organization.id === selectedOrganizationId
                      )?.name || "selected organization"}
                    </h2>
                    <p className="mt-1 text-sm text-gray-500">
                      Manage workspace membership, roles, and pending invites.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedOrganizationId(null)}
                    className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
                  >
                    Hide members
                  </button>
                </div>

                <form
                  className="border-b border-gray-200 bg-blue-50/40 px-5 py-4"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void handleSaveBilling()
                  }}
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                    <label className="text-xs font-medium text-gray-700">
                      Plan
                      <select
                        value={billingPlan}
                        onChange={(event) => setBillingPlan(event.target.value)}
                        disabled={billingSaving || selectedOrganizationIsClient}
                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900 lg:w-44"
                      >
                        <option value="client">Client workspace</option>
                        <option value="free">Free evaluation</option>
                        <option value="professional">Professional</option>
                        <option value="agency">Agency</option>
                      </select>
                    </label>
                    <label className="text-xs font-medium text-gray-700">
                      Billing/access expiration
                      <input
                        type="date"
                        value={billingExpiresAt}
                        onChange={(event) => setBillingExpiresAt(event.target.value)}
                        disabled={billingSaving || selectedOrganizationIsClient}
                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900 lg:w-52"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={billingSaving || selectedOrganizationIsClient}
                      className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {selectedOrganizationIsClient
                        ? "Managed by agency"
                        : billingSaving
                          ? "Saving..."
                          : "Save billing"}
                    </button>
                    <div className="text-sm">
                      {selectedOrganizationIsClient && (
                        <p className="text-gray-600">
                          Client workspace plan and expiry are managed by the agency workspace.
                        </p>
                      )}
                      {billingError && <p className="text-red-700">{billingError}</p>}
                      {billingMessage && <p className="text-green-700">{billingMessage}</p>}
                    </div>
                  </div>
                </form>

                <div className="border-b border-gray-200 bg-gray-50 px-5 py-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <label className="flex-1 text-xs font-medium text-gray-600">
                      External identity reference
                      <input
                        value={memberUserId}
                        onChange={(event) => setMemberUserId(event.target.value)}
                        placeholder="Provider user reference"
                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                      />
                    </label>
                    <label className="text-xs font-medium text-gray-600">
                      Role
                      <select
                        value={memberRole}
                        onChange={(event) => setMemberRole(event.target.value as "member" | "client")}
                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 sm:w-32"
                      >
                        <option value="member">Member</option>
                        <option value="client">Client</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={addingMember || !memberUserId.trim()}
                      onClick={() => {
                        void handleAddMember()
                      }}
                      className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {addingMember ? "Adding..." : "Add member"}
                    </button>
                    <button
                      type="button"
                      disabled={addingMember || !user?.id}
                      onClick={() => {
                        if (user?.id) {
                          void handleAddMember(user.id)
                        }
                      }}
                      className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Add my current account
                    </button>
                  </div>
                </div>

                <div className="border-b border-gray-200 bg-white px-5 py-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <label className="flex-1 text-xs font-medium text-gray-600">
                      Invite email
                      <input
                        type="email"
                        value={inviteEmail}
                        onChange={(event) => setInviteEmail(event.target.value)}
                        placeholder="person@company.com"
                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                      />
                    </label>
                    <label className="text-xs font-medium text-gray-600">
                      Role
                      <select
                        value={inviteRole}
                        onChange={(event) => setInviteRole(event.target.value as "member" | "client")}
                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 sm:w-32"
                      >
                        <option value="member">Member</option>
                        <option value="client">Client</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={addingInvite || !inviteEmail.trim()}
                      onClick={() => {
                        void handleAddInvite()
                      }}
                      className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {addingInvite ? "Inviting..." : "Create invite"}
                    </button>
                  </div>
                  {inviteError && (
                    <p className="mt-2 text-sm text-red-700">
                      {inviteError}
                    </p>
                  )}
                </div>

                {membersLoading && (
                  <p className="px-5 py-4 text-sm text-gray-600">
                    Loading members...
                  </p>
                )}

                {!membersLoading && membersError && (
                  <p className="px-5 py-4 text-sm text-red-700">
                    {membersError}
                  </p>
                )}

                {!membersLoading && !membersError && (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
                      <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                        <tr>
                          <th className="px-5 py-3 font-medium">User</th>
                          <th className="px-5 py-3 font-medium">Role</th>
                          <th className="px-5 py-3 font-medium">Added</th>
                          <th className="px-5 py-3 font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {members.map((member) => (
                          <tr key={member.id}>
                            <td className="px-5 py-3 font-medium text-gray-900">
                              {member.email || member.clerk_user_id}
                              {member.email && (
                                <span className="mt-1 block text-xs font-normal text-gray-400">
                                  {member.clerk_user_id}
                                </span>
                              )}
                            </td>
                            <td className="px-5 py-3 capitalize text-gray-700">
                              {member.role}
                            </td>
                            <td className="px-5 py-3 text-gray-500">
                              {member.created_at
                                ? new Date(member.created_at).toLocaleString()
                                : "Unknown"}
                            </td>
                            <td className="px-5 py-3">
                              {member.role === "owner" ? (
                                <span className="text-xs font-medium text-gray-500">
                                  Protected owner
                                </span>
                              ) : (
                                <div className="flex flex-wrap items-center gap-2">
                                  <select
                                    aria-label={`Role for ${member.clerk_user_id}`}
                                    value={memberRoleDrafts[member.id] || member.role}
                                    disabled={memberActionId === member.id}
                                    onChange={(event) => {
                                      setMemberRoleDrafts(currentDrafts => ({
                                        ...currentDrafts,
                                        [member.id]: event.target.value as "member" | "client",
                                      }))
                                    }}
                                    className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700"
                                  >
                                    <option value="member">Member</option>
                                    <option value="client">Client</option>
                                  </select>
                                  <button
                                    type="button"
                                    disabled={
                                      memberActionId === member.id ||
                                      memberRoleDrafts[member.id] === member.role
                                    }
                                    onClick={() => {
                                      void handleUpdateMemberRole(member)
                                    }}
                                    className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    disabled={memberActionId === member.id}
                                    onClick={() => {
                                      void handleRemoveMember(member)
                                    }}
                                    className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    Remove
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {!membersLoading && !membersError && invites.length > 0 && (
                  <div className="border-t border-gray-200 px-5 py-4">
                    <h3 className="text-sm font-semibold text-gray-800">
                      Pending invites
                    </h3>
                    <div className="mt-3 space-y-2">
                      {invites.map((invite) => (
                        <div
                          key={invite.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2 text-sm"
                        >
                          <span className="font-medium text-gray-800">
                            {invite.email}
                          </span>
                          <span className="capitalize text-gray-500">
                            {invite.role} · pending
                          </span>
                          <button
                            type="button"
                            disabled={inviteActionId === invite.id}
                            onClick={() => {
                              void handleRemoveInvite(invite)
                            }}
                            className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {inviteActionId === invite.id ? "Removing..." : "Cancel"}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}
          </>
        )}
        {deleteModalOrganization && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/50 px-4"
            role="presentation"
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-workspace-title"
              className="w-full max-w-lg rounded-xl border border-red-200 bg-white p-6 shadow-2xl"
            >
              <h2
                id="delete-workspace-title"
                className="text-lg font-semibold text-gray-900"
              >
                Permanently delete {deleteModalOrganization.name}?
              </h2>
              <p className="mt-3 text-sm leading-6 text-gray-600">
                This action cannot be undone. It will delete this workspace,
                its users and memberships, datasets, decisions, connections,
                invites, and all associated data.
              </p>
              {deleteModalOrganization.plan === "agency" && (
                <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
                  Because this is an agency workspace, all client workspaces
                  managed by it will be deleted as well.
                </p>
              )}
              {destructiveError && (
                <p className="mt-3 text-sm font-medium text-red-700">
                  {destructiveError}
                </p>
              )}
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  disabled={destructiveActionId !== null}
                  onClick={() => setDeleteModalOrganization(null)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={destructiveActionId !== null}
                  onClick={() => {
                    void handleConfirmOrganizationDeletion()
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 size={15} />
                  {destructiveActionId !== null
                    ? "Deleting..."
                    : "Delete permanently"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
