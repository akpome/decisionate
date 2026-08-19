"use client"

import {
  AlertTriangle,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react"
import {
  type ChangeEvent,
  useEffect,
  useState,
} from "react"

import {
  addOrganizationInvite,
  createClientWorkspace,
  createOrganization,
  deleteClientWorkspace,
  getBillingStatus,
  getMyOrganization,
  getOrganizationInvites,
  getOrganizationMembers,
  getOrganizationWorkspaces,
  removeOrganizationInvite,
  removeOrganizationMember,
  updateAgencyOwnerWorkspaceAccess,
  updateOrganizationMemberRole,
  updateMyOrganization,
  type OrganizationInviteRecord,
  type OrganizationMemberRecord,
  type OrganizationRecord,
  type OrganizationWorkspaceRecord,
  type BillingStatus,
} from "@/lib/api"
import {
  defaultBrandAccentColor,
  defaultBrandPrimaryColor,
  getReadableBrandTextColor,
  isInlineBrandLogoUrl,
  isValidBrandColor,
  isValidBrandLogoUrl,
  maxBrandLogoUploadBytes,
  maxBrandLogoUrlLength,
  supportedBrandLogoMimeTypes,
} from "@/lib/workspace-brand"
import {
  WorkspaceBrandMark,
} from "@/app/dashboard/workspace-brand-mark"
import {
  notifyWorkspaceAccessChanged,
} from "@/lib/workspace-context"
import { DashboardPageHeader } from "@/features/dashboard/components/dashboard-page-header"
import { AlertDeliverySettings } from "@/features/alerts/components/alert-delivery-settings"
import {
  useWorkspaceAccess,
} from "@/lib/use-workspace-access"

type SettingsClientProps = {
  userId: string
  fullName: string
  emailAddress: string
}

function getSettingsErrorMessage(
  error: unknown,
  fallbackMessage: string
) {
  return error instanceof Error &&
    error.message
    ? error.message
    : fallbackMessage
}

/* =========================
   Settings Client Form For Workspace Branding And Access
========================= */

export function SettingsClient({
  userId,
  fullName,
  emailAddress,
}: SettingsClientProps) {
  const {
    activeWorkspace,
    canConfigureWorkspace,
    isClientWorkspace,
    loadingWorkspaceAccess,
    workspaceRole,
  } = useWorkspaceAccess(userId)
  const [organization, setOrganization] =
    useState<OrganizationRecord | null>(null)
  const [billingStatus, setBillingStatus] =
    useState<BillingStatus | null>(null)
  const [organizationMembers, setOrganizationMembers] =
    useState<OrganizationMemberRecord[]>([])
  const [organizationWorkspaces, setOrganizationWorkspaces] =
    useState<OrganizationWorkspaceRecord[]>([])
  const [organizationName, setOrganizationName] =
    useState("")
  const [logoUrl, setLogoUrl] =
    useState("")
  const [primaryColor, setPrimaryColor] =
    useState(defaultBrandPrimaryColor)
  const [accentColor, setAccentColor] =
    useState(defaultBrandAccentColor)
  const [reportDisplayName, setReportDisplayName] =
    useState("")
  const [memberInviteEmail, setMemberInviteEmail] =
    useState("")
  const [clientWorkspaceName, setClientWorkspaceName] =
    useState("")
  const [clientWorkspaceEmail, setClientWorkspaceEmail] =
    useState("")
  const [selectedClientWorkspaceId, setSelectedClientWorkspaceId] =
    useState("")
  const [clientWorkspaceMembers, setClientWorkspaceMembers] =
    useState<OrganizationMemberRecord[]>([])
  const [clientWorkspaceInvites, setClientWorkspaceInvites] =
    useState<OrganizationInviteRecord[]>([])
  const [clientMemberInviteEmail, setClientMemberInviteEmail] =
    useState("")
  const [pendingMemberInvites, setPendingMemberInvites] =
    useState<OrganizationInviteRecord[]>([])
  const [loadingOrganization, setLoadingOrganization] =
    useState(true)
  const [savingOrganization, setSavingOrganization] =
    useState(false)
  const [accessRetrying, setAccessRetrying] =
    useState(false)
  const [organizationLoadRetryKey, setOrganizationLoadRetryKey] =
    useState(0)
  const [memberActionId, setMemberActionId] =
    useState<number | null>(null)
  const [organizationLoadError, setOrganizationLoadError] =
    useState("")
  const [saveError, setSaveError] =
    useState("")
  const [logoUploadError, setLogoUploadError] =
    useState("")
  const [memberError, setMemberError] =
    useState("")
  const [inviteError, setInviteError] =
    useState("")
  const [clientWorkspaceError, setClientWorkspaceError] =
    useState("")
  const [clientWorkspaceNotice, setClientWorkspaceNotice] =
    useState("")
  const [creatingClientWorkspace, setCreatingClientWorkspace] =
    useState(false)
  const [deletingClientWorkspace, setDeletingClientWorkspace] =
    useState(false)
  const [clientWorkspaceDeleteTarget, setClientWorkspaceDeleteTarget] =
    useState<OrganizationWorkspaceRecord | null>(null)
  const [clientWorkspaceDeleteConfirmation, setClientWorkspaceDeleteConfirmation] =
    useState("")
  const [clientWorkspaceDeleteError, setClientWorkspaceDeleteError] =
    useState("")
  const [loadingClientWorkspaceAccess, setLoadingClientWorkspaceAccess] =
    useState(false)
  const [clientWorkspaceAccessError, setClientWorkspaceAccessError] =
    useState("")
  const [clientWorkspaceAccessRetryKey, setClientWorkspaceAccessRetryKey] =
    useState(0)
  const [clientMemberActionId, setClientMemberActionId] =
    useState<number | null>(null)
  const [clientAccessAction, setClientAccessAction] =
    useState<"member-invite" | "invite" | null>(null)
  const [agencyOwnerAccessEnabled, setAgencyOwnerAccessEnabled] =
    useState(false)
  const [loadingAgencyOwnerAccess, setLoadingAgencyOwnerAccess] =
    useState(false)
  const [savingAgencyOwnerAccess, setSavingAgencyOwnerAccess] =
    useState(false)
  const [agencyOwnerAccessError, setAgencyOwnerAccessError] =
    useState("")
  const [handoffStatus, setHandoffStatus] =
    useState("")
  const [saved, setSaved] =
    useState(false)

  const workspaceDisplayName =
    reportDisplayName.trim() ||
    organizationName.trim() ||
    organization?.name ||
    "your workspace"
  const primaryColorValid =
    isValidBrandColor(primaryColor)
  const accentColorValid =
    isValidBrandColor(accentColor)
  const brandColorsValid =
    primaryColorValid && accentColorValid
  const logoUrlValid =
    isValidBrandLogoUrl(logoUrl)
  const logoUrlIsUploadedData =
    isInlineBrandLogoUrl(logoUrl)
  const previewLogoUrl =
    logoUrlValid
      ? logoUrl.trim()
      : ""
  const previewPrimaryColor =
    primaryColorValid
      ? primaryColor
      : defaultBrandPrimaryColor
  const previewAccentColor =
    accentColorValid
      ? accentColor
      : defaultBrandAccentColor
  const previewPrimaryTextColor =
    getReadableBrandTextColor(
      previewPrimaryColor,
      defaultBrandPrimaryColor
    )
  const previewAccentTextColor =
    getReadableBrandTextColor(
      previewAccentColor,
      defaultBrandAccentColor
    )
  const organizationChanged =
    organizationName.trim() !==
      (organization?.name ?? "") ||
    logoUrl.trim() !==
      (organization?.logo_url ?? "") ||
    primaryColor.trim() !==
      (organization?.primary_color ?? defaultBrandPrimaryColor) ||
    accentColor.trim() !==
      (organization?.accent_color ?? defaultBrandAccentColor) ||
    reportDisplayName.trim() !==
      (organization?.report_display_name ?? "")
  const brandResetChanged =
    Boolean(logoUrl.trim()) ||
    primaryColor !== defaultBrandPrimaryColor ||
    accentColor !== defaultBrandAccentColor ||
    Boolean(reportDisplayName.trim())
  const sharedWorkspaceCount =
    organizationWorkspaces.filter(
      (workspace) =>
        workspace.owner_user_id !== userId
    ).length
  const isClientPortalUser =
    !loadingOrganization &&
    isClientWorkspace &&
    workspaceRole === "client" &&
    !organizationLoadError &&
    sharedWorkspaceCount > 0
  const isClientWorkspaceOwner =
    isClientWorkspace &&
    workspaceRole === "client" &&
    Boolean(activeWorkspace?.owner_user_id.includes(":client:"))
  const agencyWorkspaceMembers =
    organizationMembers.filter(
      member =>
        !(
          member.role === "owner" &&
          member.clerk_user_id === organization?.owner_user_id
        )
    )
  const canCreateClientWorkspace =
    billingStatus?.billing_model === "agency" &&
    canConfigureWorkspace &&
    Boolean(organization) &&
    Boolean(clientWorkspaceName.trim()) &&
    Boolean(cleanPendingClientInviteEmail(clientWorkspaceEmail)) &&
    !creatingClientWorkspace
  const managedClientWorkspaces =
    organizationWorkspaces.filter(
      workspace =>
        workspace.owner_user_id !== userId &&
        workspace.role === "managed_client"
    )
  const selectedClientWorkspace =
    managedClientWorkspaces.find(
      workspace =>
        workspace.owner_user_id === selectedClientWorkspaceId
    ) ?? managedClientWorkspaces[0] ?? null
  const selectedClientWorkspaceOwnerId =
    selectedClientWorkspace?.owner_user_id ?? ""
  const selectedClientWorkspaceOwnerMembers =
    clientWorkspaceMembers.filter(
      member => member.role === "client"
    )
  const selectedClientWorkspaceOwnerInvite =
    clientWorkspaceInvites.find(
      invite => invite.role === "client"
    )
  const selectedClientWorkspaceMemberInvites =
    clientWorkspaceInvites.filter(
      invite => invite.role !== "client"
    )
  const selectedClientWorkspaceMembers =
    clientWorkspaceMembers.filter(
      member =>
        member.role === "member"
    )
  const canManageClientWorkspaces =
    billingStatus?.billing_model === "agency" &&
    canConfigureWorkspace

  useEffect(() => {
    let ignoreResult = false

    async function loadAgencyOwnerAccess() {
      if (!isClientWorkspaceOwner) {
        setAgencyOwnerAccessEnabled(false)
        setLoadingAgencyOwnerAccess(false)
        setAgencyOwnerAccessError("")
        return
      }

      setLoadingAgencyOwnerAccess(true)
      setAgencyOwnerAccessError("")

      try {
        const organizationData =
          await getMyOrganization(userId)

        if (!ignoreResult) {
          setAgencyOwnerAccessEnabled(
            organizationData?.agency_owner_access_enabled === true
          )
        }
      } catch (error) {
        if (!ignoreResult) {
          setAgencyOwnerAccessError(
            getSettingsErrorMessage(
              error,
              "Unable to load agency workspace access."
            )
          )
        }
      } finally {
        if (!ignoreResult) {
          setLoadingAgencyOwnerAccess(false)
        }
      }
    }

    void loadAgencyOwnerAccess()

    return () => {
      ignoreResult = true
    }
  }, [
    isClientWorkspaceOwner,
    organizationLoadRetryKey,
    userId,
  ])

  useEffect(() => {
    let ignoreResult = false

    async function loadOrganization() {
      if (!canConfigureWorkspace) {
        setBillingStatus(null)
        setLoadingOrganization(false)
        return
      }

      setLoadingOrganization(true)
      setOrganizationLoadError("")
      setSaveError("")
      setMemberError("")
      setInviteError("")

      const [
        organizationResult,
        workspaceResult,
        billingResult,
      ] = await Promise.allSettled([
        getMyOrganization(
          userId
        ),
        getOrganizationWorkspaces(
          userId,
          undefined,
          {
            includeManagedClientWorkspaces: true,
          }
        ),
        getBillingStatus(
          userId
        ),
      ])

      let memberResult:
        | PromiseSettledResult<OrganizationMemberRecord[]>
        | null = null
      let inviteResult:
        | PromiseSettledResult<OrganizationInviteRecord[]>
        | null = null

      if (
        organizationResult.status === "fulfilled" &&
        organizationResult.value
      ) {
        const accessResults = await Promise.allSettled([
          getOrganizationMembers(
            userId
          ),
          getOrganizationInvites(
            userId
          ),
        ])

        memberResult = accessResults[0]
        inviteResult = accessResults[1]
      }

      if (!ignoreResult) {
        if (organizationResult.status === "fulfilled") {
          const organizationData =
            organizationResult.value

          setOrganization(organizationData)
          setOrganizationName(organizationData?.name ?? "")
          setLogoUrl(organizationData?.logo_url ?? "")
          setPrimaryColor(
            organizationData?.primary_color ?? defaultBrandPrimaryColor
          )
          setAccentColor(
            organizationData?.accent_color ?? defaultBrandAccentColor
          )
          setReportDisplayName(
            organizationData?.report_display_name ?? ""
          )

          if (!organizationData) {
            setOrganizationMembers([])
            setPendingMemberInvites([])
          }
        } else {
          setOrganizationLoadError(
            getSettingsErrorMessage(
              organizationResult.reason,
              "Unable to load workspace settings."
            )
          )
        }

        if (memberResult?.status === "fulfilled") {
          setOrganizationMembers(
            memberResult.value
          )
        } else if (memberResult) {
          setMemberError(
            getSettingsErrorMessage(
              memberResult.reason,
              "Unable to load organization members."
            )
          )
        }

        if (workspaceResult.status === "fulfilled") {
          setOrganizationWorkspaces(
            workspaceResult.value
          )
        } else {
          setSaveError(
            getSettingsErrorMessage(
              workspaceResult.reason,
              "Unable to load workspace settings."
            )
          )
        }

        if (billingResult.status === "fulfilled") {
          setBillingStatus(billingResult.value)
        } else {
          setBillingStatus(null)
        }

        if (inviteResult?.status === "fulfilled") {
          setPendingMemberInvites(
            inviteResult.value.filter(
              invite => invite.role === "member"
            )
          )
        } else if (inviteResult) {
          setInviteError(
            getSettingsErrorMessage(
              inviteResult.reason,
              "Unable to load organization invites."
            )
          )
        }

        setLoadingOrganization(false)
      }
    }

    void loadOrganization()

    return () => {
      ignoreResult = true
    }
  }, [
    canConfigureWorkspace,
    organizationLoadRetryKey,
    userId,
  ])

  useEffect(() => {
    let ignoreResult = false

    async function loadClientWorkspaceAccess() {
      if (
        !canConfigureWorkspace ||
        !selectedClientWorkspaceOwnerId
      ) {
        setClientWorkspaceMembers([])
        setClientWorkspaceInvites([])
        setLoadingClientWorkspaceAccess(false)
        setClientWorkspaceAccessError("")
        return
      }

      setLoadingClientWorkspaceAccess(true)
      setClientWorkspaceAccessError("")

      const [memberResult, inviteResult] =
        await Promise.allSettled([
          getOrganizationMembers(
            userId,
            selectedClientWorkspaceOwnerId
          ),
          getOrganizationInvites(
            userId,
            selectedClientWorkspaceOwnerId
          ),
        ])

      if (ignoreResult) return

      if (memberResult.status === "fulfilled") {
        setClientWorkspaceMembers(memberResult.value)
      } else {
        setClientWorkspaceAccessError(
          getSettingsErrorMessage(
            memberResult.reason,
            "Unable to load client workspace members."
          )
        )
      }

      if (inviteResult.status === "fulfilled") {
        setClientWorkspaceInvites(inviteResult.value)
      } else {
        setClientWorkspaceAccessError(
          getSettingsErrorMessage(
            inviteResult.reason,
            "Unable to load client workspace invites."
          )
        )
      }

      setLoadingClientWorkspaceAccess(false)
    }

    void loadClientWorkspaceAccess()

    return () => {
      ignoreResult = true
    }
  }, [
    canConfigureWorkspace,
    clientWorkspaceAccessRetryKey,
    selectedClientWorkspaceOwnerId,
    userId,
  ])

  async function handleSaveOrganization() {
    if (
      savingOrganization ||
      !organizationChanged ||
      !organizationName.trim() ||
      !brandColorsValid ||
      !logoUrlValid
    ) {
      return
    }

    setSavingOrganization(true)
    setSaveError("")
    setMemberError("")
    setInviteError("")
    setSaved(false)

    try {
      const cleanOrganizationName =
        organizationName.trim()
      const organizationPayload = {
        name: cleanOrganizationName,
        logo_url: logoUrl.trim() || null,
        primary_color: primaryColor.trim() || null,
        accent_color: accentColor.trim() || null,
        report_display_name:
          reportDisplayName.trim() || null,
      }
      const data =
        organization
          ? await updateMyOrganization(
            organizationPayload,
            userId
          )
          : await createOrganization(
            organizationPayload,
            userId
          )

      setOrganization(data)
      setOrganizationName(data.name)
      setLogoUrl(data.logo_url ?? "")
      setPrimaryColor(
        data.primary_color ?? defaultBrandPrimaryColor
      )
      setAccentColor(
        data.accent_color ?? defaultBrandAccentColor
      )
      setReportDisplayName(
        data.report_display_name ?? ""
      )
      window.dispatchEvent(
        new CustomEvent(
          "decisionate:organization-updated",
          {
            detail: data,
          }
        )
      )

      const [
        memberResult,
        workspaceResult,
        inviteResult,
      ] = await Promise.allSettled([
        getOrganizationMembers(
          userId
        ),
        getOrganizationWorkspaces(
          userId,
          undefined,
          {
            includeManagedClientWorkspaces: true,
          }
        ),
        getOrganizationInvites(
          userId
        ),
      ])

      if (memberResult.status === "fulfilled") {
        setOrganizationMembers(
          memberResult.value
        )
        setMemberError("")
      } else {
        setMemberError(
          getSettingsErrorMessage(
            memberResult.reason,
            "Unable to refresh organization members."
          )
        )
      }

      if (workspaceResult.status === "fulfilled") {
        setOrganizationWorkspaces(
          workspaceResult.value
        )
        setSaveError("")
      } else {
        setSaveError(
          "Workspace saved, but workspace access data could not be refreshed."
        )
      }

      if (inviteResult.status === "fulfilled") {
        setInviteError("")
      } else {
        setInviteError(
          getSettingsErrorMessage(
            inviteResult.reason,
            "Unable to refresh organization invites."
          )
        )
      }

      setSaved(true)

      setTimeout(() => {
        setSaved(false)
      }, 3000)
    } catch (error) {
      console.error(error)
      setSaveError(
        getSettingsErrorMessage(
          error,
          "Workspace settings could not be saved."
        )
      )
    } finally {
      setSavingOrganization(false)
    }
  }

  async function handleAgencyOwnerAccessChange(
    enabled: boolean
  ) {
    if (
      !isClientWorkspaceOwner ||
      savingAgencyOwnerAccess
    ) {
      return
    }

    setSavingAgencyOwnerAccess(true)
    setAgencyOwnerAccessError("")

    try {
      const organizationData =
        await updateAgencyOwnerWorkspaceAccess(
          enabled,
          userId
        )
      setAgencyOwnerAccessEnabled(
        organizationData.agency_owner_access_enabled === true
      )
      notifyWorkspaceAccessChanged()
    } catch (error) {
      setAgencyOwnerAccessError(
        getSettingsErrorMessage(
          error,
          "Unable to update agency workspace access."
        )
      )
    } finally {
      setSavingAgencyOwnerAccess(false)
    }
  }

  function handleResetBranding() {
    if (
      loadingOrganization ||
      savingOrganization ||
      !brandResetChanged
    ) {
      return
    }

    setLogoUrl("")
    setPrimaryColor(defaultBrandPrimaryColor)
    setAccentColor(defaultBrandAccentColor)
    setReportDisplayName("")
    setSaveError("")
    setLogoUploadError("")
    setSaved(false)
  }

  async function handleLogoUpload(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const file =
      event.currentTarget.files?.[0]

    if (!file) {
      return
    }

    setSaveError("")
    setLogoUploadError("")
    setSaved(false)

    if (
      !supportedBrandLogoMimeTypes.includes(
        file.type as (typeof supportedBrandLogoMimeTypes)[number]
      )
    ) {
      setLogoUploadError(
        "Upload a PNG, JPG, WebP, GIF, or SVG logo."
      )
      event.currentTarget.value = ""
      return
    }

    if (file.size > maxBrandLogoUploadBytes) {
      setLogoUploadError(
        `Logo upload must be ${formatFileSize(maxBrandLogoUploadBytes)} or smaller.`
      )
      event.currentTarget.value = ""
      return
    }

    try {
      const dataUrl =
        await readFileAsDataUrl(file)

      if (!isValidBrandLogoUrl(dataUrl)) {
        setLogoUploadError(
          "That logo image could not be saved. Try a smaller image or paste an HTTPS logo link."
        )
        event.currentTarget.value = ""
        return
      }

      setLogoUrl(dataUrl)
    } catch {
      setLogoUploadError(
        "That logo image could not be read. Try another file or paste an HTTPS logo link."
      )
    } finally {
      event.currentTarget.value = ""
    }
  }

  async function handleRetryOrganizationAccess() {
    if (accessRetrying) {
      return
    }

    setAccessRetrying(true)
    setMemberError("")
    setInviteError("")

    const [memberResult, inviteResult] =
      await Promise.allSettled([
        getOrganizationMembers(
          userId
        ),
        getOrganizationInvites(
          userId
        ),
      ])

    if (memberResult.status === "fulfilled") {
      setOrganizationMembers(
        memberResult.value
      )
    } else {
      setMemberError(
        getSettingsErrorMessage(
          memberResult.reason,
          "Unable to load organization members."
        )
      )
    }

    if (inviteResult.status === "fulfilled") {
      setPendingMemberInvites(
        inviteResult.value.filter(
          invite => invite.role === "member"
        )
      )
    } else {
      setInviteError(
        getSettingsErrorMessage(
          inviteResult.reason,
          "Unable to load organization invites."
        )
      )
    }

    setAccessRetrying(false)
  }

  async function handleInviteMember() {
    if (!organization || !canConfigureWorkspace) return

    const cleanEmail =
      cleanPendingClientInviteEmail(
        memberInviteEmail
      )

    if (!cleanEmail) {
      setInviteError(
        "Enter a valid teammate email."
      )
      return
    }

    if (
      pendingMemberInvites.some(
        invite => invite.email === cleanEmail
      )
    ) {
      setInviteError(
        "That teammate email already has a pending invite."
      )
      return
    }

    try {
      const invite = await addOrganizationInvite(
        {
          email: cleanEmail,
          role: "member",
        },
        userId
      )
      setPendingMemberInvites(
        currentInvites => [
          ...currentInvites.filter(
            currentInvite => currentInvite.id !== invite.id
          ),
          invite,
        ]
      )
      setMemberInviteEmail("")
      setInviteError("")
    } catch (error) {
      console.error(error)
      setInviteError(
        getSettingsErrorMessage(
          error,
          "Teammate invite could not be created."
        )
      )
    }
  }

  async function handleCopyClientHandoffNote() {
    if (!organization) return

    const portalUrl =
      typeof window === "undefined"
        ? "/dashboard"
        : `${window.location.origin}/dashboard`
    const message =
      `Hi — ${workspaceDisplayName} has shared a client workspace with you.\n\n` +
      `Sign in here: ${portalUrl}\n\n` +
      "Once you sign in, your shared client workspace will open in the sidebar. You can review dashboards, datasets, reports, forecasts, and decisions from that workspace."

    if (
      typeof navigator === "undefined" ||
      !navigator.clipboard
    ) {
      setHandoffStatus(message)
      return
    }

    try {
      await navigator.clipboard.writeText(
        message
      )
      setHandoffStatus(
        "Client handoff note copied."
      )
    } catch {
      setHandoffStatus(message)
    }

    window.setTimeout(() => {
      setHandoffStatus("")
    }, 3500)
  }

  async function handleCreateClientWorkspace() {
    if (!canCreateClientWorkspace) return

    const cleanEmail =
      cleanPendingClientInviteEmail(
        clientWorkspaceEmail
      )

    if (!cleanEmail) {
      setClientWorkspaceError(
        "Enter a valid client email."
      )
      return
    }

    setCreatingClientWorkspace(true)
    setClientWorkspaceError("")
    setClientWorkspaceNotice("")

    try {
      const workspace =
        await createClientWorkspace(
          {
            name: clientWorkspaceName.trim(),
            client_email: cleanEmail,
          },
          userId
        )

      setOrganizationWorkspaces(
        currentWorkspaces => [
          ...currentWorkspaces.filter(
            currentWorkspace =>
              currentWorkspace.id !== workspace.id
          ),
          workspace,
        ]
      )
      setSelectedClientWorkspaceId(
        workspace.owner_user_id
      )
      setClientWorkspaceName("")
      setClientWorkspaceEmail("")
      setClientWorkspaceNotice(
        `${workspace.name} is ready. The client invite is waiting for ${cleanEmail} to sign in.${workspace.billing_notice ? ` ${workspace.billing_notice}` : ""}`
      )
    } catch (error) {
      console.error(error)
      setClientWorkspaceError(
        getSettingsErrorMessage(
          error,
          "Client workspace could not be created."
        )
      )
    } finally {
      setCreatingClientWorkspace(false)
    }
  }

  function handleOpenDeleteClientWorkspace() {
    if (!selectedClientWorkspace || deletingClientWorkspace) return

    setClientWorkspaceDeleteTarget(selectedClientWorkspace)
    setClientWorkspaceDeleteConfirmation("")
    setClientWorkspaceDeleteError("")
  }

  function handleCloseDeleteClientWorkspace() {
    if (deletingClientWorkspace) return

    setClientWorkspaceDeleteTarget(null)
    setClientWorkspaceDeleteConfirmation("")
    setClientWorkspaceDeleteError("")
  }

  async function handleDeleteClientWorkspace() {
    if (
      !clientWorkspaceDeleteTarget ||
      deletingClientWorkspace ||
      clientWorkspaceDeleteConfirmation.trim() !==
        clientWorkspaceDeleteTarget.name.trim()
    ) {
      return
    }

    const workspaceName = clientWorkspaceDeleteTarget.name

    setDeletingClientWorkspace(true)
    setClientWorkspaceDeleteError("")
    setClientWorkspaceNotice("")

    try {
      await deleteClientWorkspace(
        clientWorkspaceDeleteTarget.id,
        userId
      )

      const remainingManagedWorkspaces =
        managedClientWorkspaces.filter(
          workspace => workspace.id !== clientWorkspaceDeleteTarget.id
        )
      setOrganizationWorkspaces(
        currentWorkspaces =>
          currentWorkspaces.filter(
            workspace => workspace.id !== clientWorkspaceDeleteTarget.id
          )
      )
      setSelectedClientWorkspaceId(
        remainingManagedWorkspaces[0]?.owner_user_id ?? ""
      )
      setClientWorkspaceMembers([])
      setClientWorkspaceInvites([])
      setClientWorkspaceAccessError("")
      setClientWorkspaceNotice(
        `${workspaceName} and its workspace data were deleted.`
      )
      setClientWorkspaceDeleteTarget(null)
      setClientWorkspaceDeleteConfirmation("")
    } catch (error) {
      console.error(error)
      setClientWorkspaceDeleteError(
        getSettingsErrorMessage(
          error,
          "Client workspace could not be deleted."
        )
      )
    } finally {
      setDeletingClientWorkspace(false)
    }
  }

  async function handleInviteClientWorkspaceCollaborator() {
    if (
      !canManageClientWorkspaces ||
      !selectedClientWorkspaceOwnerId ||
      !cleanPendingClientInviteEmail(clientMemberInviteEmail) ||
      clientAccessAction
    ) {
      return
    }

    const cleanEmail =
      cleanPendingClientInviteEmail(
        clientMemberInviteEmail
      )

    if (!cleanEmail) return

    setClientAccessAction("member-invite")
    setClientWorkspaceAccessError("")

    try {
      await addOrganizationInvite(
        {
          email: cleanEmail,
          role: "member",
        },
        userId,
        selectedClientWorkspaceOwnerId
      )
      setClientMemberInviteEmail("")
      setClientWorkspaceAccessRetryKey(
        currentKey => currentKey + 1
      )
    } catch (error) {
      console.error(error)
      setClientWorkspaceAccessError(
        getSettingsErrorMessage(
          error,
          "Client member invite could not be created."
        )
      )
    } finally {
      setClientAccessAction(null)
    }
  }

  async function handleRemoveClientMember(
    member: OrganizationMemberRecord
  ) {
    if (
      !canManageClientWorkspaces ||
      !selectedClientWorkspaceOwnerId ||
      member.role === "owner" ||
      clientMemberActionId
    ) {
      return
    }

    setClientMemberActionId(member.id)
    setClientWorkspaceAccessError("")

    try {
      await removeOrganizationMember(
        member.id,
        userId,
        selectedClientWorkspaceOwnerId
      )
      setClientWorkspaceAccessRetryKey(
        currentKey => currentKey + 1
      )
    } catch (error) {
      console.error(error)
      setClientWorkspaceAccessError(
        getSettingsErrorMessage(
          error,
          "Client workspace member could not be removed."
        )
      )
    } finally {
      setClientMemberActionId(null)
    }
  }

  async function handleUpdateClientMemberRole(
    member: OrganizationMemberRecord,
    nextRole: "member" | "client"
  ) {
    if (
      !canManageClientWorkspaces ||
      !selectedClientWorkspaceOwnerId ||
      member.role === nextRole ||
      clientMemberActionId
    ) {
      return
    }

    setClientMemberActionId(member.id)
    setClientWorkspaceAccessError("")

    try {
      const updatedMember =
        await updateOrganizationMemberRole(
          member.id,
          nextRole,
          userId,
          selectedClientWorkspaceOwnerId
        )
      setClientWorkspaceMembers(
        currentMembers =>
          currentMembers.map(
            currentMember =>
              currentMember.id === updatedMember.id
                ? updatedMember
                : currentMember
          )
      )
    } catch (error) {
      console.error(error)
      setClientWorkspaceAccessError(
        getSettingsErrorMessage(
          error,
          "Client member role could not be updated."
        )
      )
    } finally {
      setClientMemberActionId(null)
    }
  }

  async function handleRemoveClientInvite(
    invite: OrganizationInviteRecord
  ) {
    if (
      !canManageClientWorkspaces ||
      !selectedClientWorkspaceOwnerId ||
      clientAccessAction
    ) {
      return
    }

    setClientAccessAction("invite")
    setClientWorkspaceAccessError("")

    try {
      await removeOrganizationInvite(
        invite.id,
        userId,
        selectedClientWorkspaceOwnerId
      )
      setClientWorkspaceAccessRetryKey(
        currentKey => currentKey + 1
      )
    } catch (error) {
      console.error(error)
      setClientWorkspaceAccessError(
        getSettingsErrorMessage(
          error,
          "Client workspace invite could not be removed."
        )
      )
    } finally {
      setClientAccessAction(null)
    }
  }

  async function handleRemovePendingMemberInvite(
    invite: OrganizationInviteRecord
  ) {
    if (!organization || !canConfigureWorkspace) return

    try {
      await removeOrganizationInvite(
        invite.id,
        userId
      )

      const removeInvite = (
        currentInvites: OrganizationInviteRecord[]
      ) =>
        currentInvites.filter(
          currentInvite => currentInvite.id !== invite.id
        )

      setPendingMemberInvites(removeInvite)
      setInviteError("")
    } catch (error) {
      console.error(error)
      setInviteError(
        getSettingsErrorMessage(
          error,
          "Teammate invite could not be removed."
        )
      )
    }
  }

  /* =========================
     Organization Member Role Update And Removal Actions
  ========================= */

  async function handleUpdateMemberRole(
    member: OrganizationMemberRecord,
    nextRole: string
  ) {
    if (
      !canConfigureWorkspace ||
      (
        member.role === "owner" &&
        member.clerk_user_id === organization?.owner_user_id
      ) ||
      member.role === nextRole ||
      memberActionId
    ) {
      return
    }

    setMemberActionId(member.id)
    setMemberError("")

    try {
      const updatedMember =
        await updateOrganizationMemberRole(
          member.id,
          nextRole,
          userId
        )

      setOrganizationMembers(
        currentMembers =>
          currentMembers.map(
            currentMember =>
              currentMember.id === updatedMember.id
                ? updatedMember
                : currentMember
          )
      )
    } catch (error) {
      console.error(error)
      setMemberError(
        getSettingsErrorMessage(
          error,
          "Member role could not be updated."
        )
      )
    } finally {
      setMemberActionId(null)
    }
  }

  async function handleRemoveMember(
    member: OrganizationMemberRecord
  ) {
    if (
      !canConfigureWorkspace ||
      (
        member.role === "owner" &&
        member.clerk_user_id === organization?.owner_user_id
      ) ||
      memberActionId
    ) {
      return
    }

    setMemberActionId(member.id)
    setMemberError("")

    try {
      await removeOrganizationMember(
        member.id,
        userId
      )

      setOrganizationMembers(
        currentMembers =>
          currentMembers.filter(
            currentMember =>
              currentMember.id !== member.id
          )
      )
    } catch (error) {
      console.error(error)
      setMemberError(
        getSettingsErrorMessage(
          error,
          "Member could not be removed."
        )
      )
    } finally {
      setMemberActionId(null)
    }
  }

  if (loadingWorkspaceAccess) {
    return (
      <div className="space-y-6">
        <DashboardPageHeader
          title="Settings"
          description="Workspace configuration is available to the business owner."
        />
        <div
          role="status"
          className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500"
        >
          Checking workspace access...
        </div>
      </div>
    )
  }

  if (!canConfigureWorkspace) {
    return (
      <div className="space-y-6">
        <DashboardPageHeader
          title="Settings"
          description="Workspace configuration is available to the business owner."
        />
        {isClientWorkspaceOwner ? (
          <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold">
                  Agency workspace access
                </h2>
                <p className="mt-1 max-w-2xl text-sm text-gray-500">
                  Allow the agency owner to open this client workspace for analysis. Agency access is read-only for data setup: the agency owner will not see Data navigation and cannot add datasets or configure connections.
                </p>
              </div>

              <label className="inline-flex shrink-0 items-center gap-3 text-sm font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={agencyOwnerAccessEnabled}
                  onChange={(event) =>
                    void handleAgencyOwnerAccessChange(
                      event.target.checked
                    )
                  }
                  disabled={
                    loadingAgencyOwnerAccess ||
                    savingAgencyOwnerAccess
                  }
                  className="h-4 w-4 rounded border-gray-300 text-[var(--decisionate-brand-primary)] focus:ring-[var(--decisionate-brand-primary-ring)]"
                />
                {savingAgencyOwnerAccess
                  ? "Saving..."
                  : agencyOwnerAccessEnabled
                    ? "Agency access enabled"
                    : "Allow agency access"}
              </label>
            </div>

            {agencyOwnerAccessError && (
              <p role="alert" className="mt-3 text-sm font-medium text-red-600">
                {agencyOwnerAccessError}
              </p>
            )}
          </section>
        ) : (
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            {isClientWorkspace
              ? "This workspace is managed by the agency owner."
              : "Only the business owner can manage workspace settings, branding, members, and service configuration."}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      {/* =========================
          Settings Page Header For Account And Workspace Management
      ========================= */}

      <DashboardPageHeader
        title="Settings"
        description={
          isClientPortalUser
            ? "Review the workspaces that have been shared with you."
            : canManageClientWorkspaces
              ? "Manage your workspace, team members, and client workspaces."
              : "Manage your workspace and team members."
        }
      />

      {isClientPortalUser && (
        <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
          <div>
            <h2 className="text-xl font-semibold">
              Shared Workspaces
            </h2>

            <p className="mt-1 text-sm text-gray-500">
              Workspaces shared with your account.
            </p>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {organizationWorkspaces
              .filter(
                workspace =>
                  workspace.owner_user_id !== userId
              )
              .map(workspace => (
                <div
                  key={workspace.id}
                  className="flex min-w-0 items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3"
                >
                  <WorkspaceBrandMark
                    name={workspace.name}
                    logoUrl={workspace.logo_url}
                    primaryColor={workspace.primary_color}
                    className="h-10 w-10 shrink-0 rounded-xl text-sm"
                  />

                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900">
                      {workspace.name}
                    </p>
                    <p className="mt-0.5 text-xs capitalize text-gray-500">
                      {workspace.role} access
                    </p>
                  </div>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* =========================
          Workspace Profile And Branding Section
      ========================= */}

      {!isClientPortalUser && (
        <div className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold">
              Workspace
            </h2>

            <p className="mt-1 text-sm text-gray-500">
              Configure the workspace identity and branding used throughout Decisionate.
            </p>
          </div>

          {saved && (
            <span
              role="status"
              aria-live="polite"
              className="w-fit rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-medium text-green-700"
            >
              Saved
            </span>
          )}
        </div>

        <div className="mt-5 rounded-xl border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] p-4">
          <div className="flex flex-col gap-1 rounded-lg border border-white/70 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="break-all text-sm font-medium text-gray-900">
                {emailAddress || fullName || "Current account"}
              </p>
              {emailAddress && fullName && (
                <p className="text-xs text-gray-500">
                  {fullName}
                </p>
              )}
            </div>
            <span className="w-fit rounded-full bg-[var(--decisionate-brand-primary-soft)] px-2.5 py-1 text-xs font-medium text-[var(--decisionate-brand-primary-text)]">
              Owner
            </span>
          </div>
        </div>

        {organizationLoadError && (
          <div
            role="alert"
            className="mb-5 flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between"
          >
            <span>{organizationLoadError}</span>

            <button
              type="button"
              onClick={() =>
                setOrganizationLoadRetryKey(currentKey => currentKey + 1)
              }
              disabled={loadingOrganization}
              className="w-fit shrink-0 rounded-lg border border-red-200 bg-white px-3 py-2 font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingOrganization
                ? "Retrying..."
                : "Retry workspace load"}
            </button>
          </div>
        )}

        <div className="space-y-5">
          <div>
            <label
              htmlFor="workspace-name"
              className="mb-2 block text-sm font-medium text-gray-600"
            >
              Workspace Name
            </label>

            <input
              id="workspace-name"
              type="text"
              value={organizationName}
              onChange={(event) => {
                setOrganizationName(
                  event.target.value
                )
                setSaveError("")
                setSaved(false)
              }}
              placeholder={
                loadingOrganization
                  ? "Loading workspace..."
                  : "My Workspace"
              }
              disabled={loadingOrganization}
              className="w-full rounded-xl border p-3 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
            />
          </div>

          <div>
            <label
              htmlFor="workspace-logo-url"
              className="mb-2 block text-sm font-medium text-gray-600"
            >
              Logo link or upload
            </label>

            <input
              id="workspace-logo-url"
              type="text"
              value={
                logoUrlIsUploadedData
                  ? ""
                  : logoUrl
              }
              onChange={(event) => {
                setLogoUrl(
                  event.target.value
                )
                setSaveError("")
                setLogoUploadError("")
                setSaved(false)
              }}
              onBlur={() => {
                if (logoUrlIsUploadedData) {
                  return
                }

                const cleanLogoUrl = logoUrl.trim()

                if (cleanLogoUrl !== logoUrl) {
                  setLogoUrl(cleanLogoUrl)
                }
              }}
              placeholder={
                logoUrlIsUploadedData
                  ? "Uploaded logo selected. Paste a URL to replace it."
                  : "https://example.com/logo.png"
              }
              maxLength={maxBrandLogoUrlLength}
              aria-invalid={!logoUrlValid}
              aria-describedby={
                !logoUrlValid
                  ? "workspace-logo-url-error"
                  : undefined
              }
              disabled={loadingOrganization}
              className={`w-full rounded-xl border p-3 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 ${
                logoUrlValid
                  ? "border-gray-200"
                  : "border-red-300 bg-red-50"
              }`}
            />

            <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-700">
                    Upload logo image
                  </p>

                  <p className="mt-1 text-xs text-gray-500">
                    Use a small PNG, JPG, WebP, GIF, or SVG up to {formatFileSize(maxBrandLogoUploadBytes)}. This logo appears in the app, shared dashboards, and print/PDF exports.
                  </p>
                </div>

                <label className="inline-flex w-full cursor-pointer items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 sm:w-auto">
                  Choose file
                  <input
                    type="file"
                    accept={supportedBrandLogoMimeTypes.join(",")}
                    className="sr-only"
                    disabled={loadingOrganization}
                    onChange={handleLogoUpload}
                  />
                </label>
              </div>

              {logoUrlIsUploadedData && (
                <p className="mt-3 text-xs font-medium text-[var(--decisionate-brand-primary-text)]">
                  Uploaded logo selected. Save changes to use it everywhere.
                </p>
              )}

              {logoUrl.trim() && (
                <button
                  type="button"
                  onClick={() => {
                    setLogoUrl("")
                    setLogoUploadError("")
                    setSaveError("")
                    setSaved(false)
                  }}
                  className="mt-3 text-xs font-medium text-gray-600 underline-offset-4 hover:underline"
                >
                  Remove logo
                </button>
              )}
            </div>

            {!logoUrlValid && (
              <p
                id="workspace-logo-url-error"
                role="alert"
                className="mt-1.5 text-xs font-medium text-red-600"
              >
                Enter an HTTP(S) image URL, upload a supported logo image, or leave it blank.
              </p>
            )}

            {logoUploadError && (
              <p
                role="alert"
                className="mt-1.5 text-xs font-medium text-red-600"
              >
                {logoUploadError}
              </p>
            )}
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <BrandColorField
              label="Primary Color"
              value={primaryColor}
              fallbackColor={defaultBrandPrimaryColor}
              disabled={loadingOrganization}
              onChange={(value) => {
                setPrimaryColor(value)
                setSaveError("")
                setSaved(false)
              }}
            />

            <BrandColorField
              label="Accent Color"
              value={accentColor}
              fallbackColor={defaultBrandAccentColor}
              disabled={loadingOrganization}
              onChange={(value) => {
                setAccentColor(value)
                setSaveError("")
                setSaved(false)
              }}
            />
          </div>

          <div>
            <label
              htmlFor="workspace-report-display-name"
              className="mb-2 block text-sm font-medium text-gray-600"
            >
              Report Display Name
            </label>

            <input
              id="workspace-report-display-name"
              type="text"
              value={reportDisplayName}
              onChange={(event) => {
                setReportDisplayName(
                  event.target.value
                )
                setSaveError("")
                setSaved(false)
              }}
              placeholder={organizationName || "Optional display name for reports"}
              disabled={loadingOrganization}
              className="w-full rounded-xl border p-3 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
            />
          </div>

          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Shared view preview
            </p>

            <div className="mt-3 flex min-w-0 items-center gap-3">
              <WorkspaceBrandMark
                name={
                  reportDisplayName ||
                  organizationName ||
                  "Workspace Brand"
                }
                logoUrl={previewLogoUrl}
                primaryColor={previewPrimaryColor}
                className="h-12 w-12 rounded-xl text-sm"
              />

              <div className="min-w-0">
                <p
                  className="truncate font-medium"
                  style={{
                    color: previewPrimaryTextColor,
                  }}
                >
                  {reportDisplayName ||
                    organizationName ||
                    "Workspace Brand"}
                </p>

                <p
                  className="text-sm"
                  style={{
                    color: previewAccentTextColor,
                  }}
                >
                  Decision workspace
                </p>
              </div>
            </div>
          </div>

          {saveError && (
            <p
              role="alert"
              className="text-sm font-medium text-red-600"
            >
              {saveError}
            </p>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <button
              type="button"
              onClick={handleSaveOrganization}
              disabled={
                loadingOrganization ||
                savingOrganization ||
                !organizationChanged ||
                !organizationName.trim() ||
                !brandColorsValid ||
                !logoUrlValid
              }
              className="w-full rounded-xl bg-[var(--decisionate-brand-primary)] px-5 py-3 text-sm font-medium text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-white sm:w-auto"
            >
              {savingOrganization
                ? "Saving..."
                : "Save Changes"}
            </button>

            <button
              type="button"
              onClick={handleResetBranding}
              disabled={
                loadingOrganization ||
                savingOrganization ||
                !brandResetChanged
              }
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400 sm:w-auto"
            >
              <RotateCcw size={16} />
              Reset Branding
            </button>
          </div>
        </div>
      </div>
      )}

      {!isClientPortalUser && (
        <AlertDeliverySettings userId={userId} />
      )}

      {/* =========================
          Client Workspace Management Section For Owner And Member Access
      ========================= */}

      {!isClientPortalUser && canManageClientWorkspaces && (
        <section className="order-last rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
          <div>
            <h2 className="text-xl font-semibold">
              Client Workspaces
            </h2>

            <p className="mt-1 text-sm text-gray-500">
              Client workspace data stays isolated from the agency. Manage
              members or delete client workspaces here; client users access
              their workspace by signing in.
            </p>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <input
              aria-label="Client workspace name"
              type="text"
              value={clientWorkspaceName}
              onChange={(event) => {
                setClientWorkspaceName(event.target.value)
                setClientWorkspaceError("")
                setClientWorkspaceNotice("")
              }}
              placeholder="Client workspace name"
              disabled={!organization || creatingClientWorkspace}
              className="h-10 rounded-xl border px-3 text-sm disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
            />

            <input
              aria-label="Client email"
              type="email"
              value={clientWorkspaceEmail}
              onChange={(event) => {
                setClientWorkspaceEmail(event.target.value)
                setClientWorkspaceError("")
                setClientWorkspaceNotice("")
              }}
              placeholder="client@example.com"
              disabled={!organization || creatingClientWorkspace}
              className="h-10 rounded-xl border px-3 text-sm disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
            />

            <button
              type="button"
              onClick={handleCreateClientWorkspace}
              disabled={!canCreateClientWorkspace}
              className="h-10 rounded-xl bg-[var(--decisionate-brand-primary)] px-4 text-sm font-medium text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500"
            >
              {creatingClientWorkspace
                ? "Creating..."
                : "Create Workspace"}
            </button>
          </div>

          {clientWorkspaceError && (
            <p role="alert" className="mt-3 text-sm font-medium text-red-600">
              {clientWorkspaceError}
            </p>
          )}

          {clientWorkspaceNotice && (
            <p role="status" className="mt-3 text-sm font-medium text-green-700">
              {clientWorkspaceNotice}
            </p>
          )}

          {selectedClientWorkspace && (
            <div className="mt-5 space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <select
                    aria-label="Client workspace to manage"
                    value={selectedClientWorkspaceOwnerId}
                    onChange={(event) =>
                      setSelectedClientWorkspaceId(
                        event.target.value
                      )
                    }
                    disabled={deletingClientWorkspace}
                    className="h-9 w-full rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-700 disabled:cursor-not-allowed disabled:bg-gray-50 sm:w-64"
                  >
                    {managedClientWorkspaces.map(workspace => (
                      <option
                        key={workspace.id}
                        value={workspace.owner_user_id}
                      >
                        {workspace.name}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={handleOpenDeleteClientWorkspace}
                    disabled={deletingClientWorkspace}
                    title="Delete client workspace"
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-red-200 px-3 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:text-gray-400"
                  >
                    <Trash2 size={15} />
                    {deletingClientWorkspace
                      ? "Deleting..."
                      : "Delete Workspace"}
                  </button>
                </div>
              </div>

              <div className="flex min-h-12 flex-col gap-2 rounded-xl border border-gray-100 bg-gray-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                  {loadingClientWorkspaceAccess ? (
                    <p className="text-sm text-gray-500">
                      Loading client owner...
                    </p>
                  ) : selectedClientWorkspaceOwnerMembers.length > 0 ? (
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                        Owner
                      </span>
                      <div className="flex min-w-0 flex-wrap gap-2">
                        {selectedClientWorkspaceOwnerMembers.map(member => (
                          <span
                            key={member.id}
                            className="truncate text-sm font-medium text-gray-900"
                          >
                            {member.email || "Email unavailable"}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : selectedClientWorkspaceOwnerInvite ? (
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                        Owner
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900">
                          {selectedClientWorkspaceOwnerInvite.email}
                        </p>
                        <span className="text-xs text-gray-500">
                          Invitation pending
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          handleRemoveClientInvite(
                            selectedClientWorkspaceOwnerInvite
                          )
                        }
                        disabled={Boolean(clientAccessAction)}
                        className="w-fit text-xs font-medium text-red-600 underline underline-offset-2 disabled:text-gray-400"
                      >
                        Revoke invitation
                      </button>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">
                      No client owner invitation is associated with this workspace.
                    </p>
                  )}
              </div>

                <div className="rounded-xl border border-gray-100 bg-white p-4">
                <h4 className="text-sm font-semibold text-gray-900">
                  Client workspace members
                </h4>
                <p className="mt-1 text-xs text-gray-500">
                  Invite additional members and manage their access.
                </p>

              <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  aria-label="Client member email"
                  type="email"
                  value={clientMemberInviteEmail}
                  onChange={(event) =>
                    setClientMemberInviteEmail(event.target.value)
                  }
                  placeholder="client-member@example.com"
                  disabled={Boolean(clientAccessAction)}
                  className="h-10 rounded-xl border bg-white px-3 text-sm disabled:cursor-not-allowed disabled:bg-gray-100"
                />
                <button
                  type="button"
                  onClick={handleInviteClientWorkspaceCollaborator}
                  disabled={
                    !cleanPendingClientInviteEmail(clientMemberInviteEmail) ||
                    Boolean(clientAccessAction)
                  }
                  className="h-10 rounded-xl border border-[var(--decisionate-brand-primary-ring)] bg-white px-4 text-sm font-medium text-[var(--decisionate-brand-primary-text)] disabled:cursor-not-allowed disabled:text-gray-400"
                >
                  {clientAccessAction === "member-invite"
                    ? "Inviting..."
                    : "Invite Client Member"}
                </button>
              </div>

              {clientWorkspaceAccessError && (
                <div className="mt-3 flex flex-col gap-2 text-sm text-red-600 sm:flex-row sm:items-center sm:justify-between">
                  <span role="alert">
                    {clientWorkspaceAccessError}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setClientWorkspaceAccessRetryKey(
                        currentKey => currentKey + 1
                      )
                    }
                    className="w-fit font-medium underline underline-offset-2"
                  >
                    Retry
                  </button>
                </div>
              )}

              {loadingClientWorkspaceAccess ? (
                <p className="mt-4 text-sm text-gray-500">
                  Loading workspace access...
                </p>
              ) : (
                <>
                  <div className="mt-4 divide-y divide-gray-100 rounded-xl border border-gray-100 bg-white">
                    {selectedClientWorkspaceMembers.length > 0 ? (
                      selectedClientWorkspaceMembers.map(member => (
                        <div
                          key={member.id}
                          className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <p className="break-all text-sm font-medium text-gray-900">
                              {member.email || "Email unavailable"}
                            </p>
                            <p className="text-xs capitalize text-gray-500">
                              {member.role === "client"
                                ? "Owner access"
                                : "Member access"}
                            </p>
                          </div>

                          <div className="flex flex-wrap gap-2 sm:shrink-0">
                            <select
                              aria-label={`Role for ${member.email || "client member"}`}
                              value={member.role === "client" ? "client" : "member"}
                              onChange={event =>
                                handleUpdateClientMemberRole(
                                  member,
                                  event.target.value as "member" | "client"
                                )
                              }
                              disabled={clientMemberActionId === member.id}
                              className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
                            >
                              <option value="member">Member</option>
                              <option value="client">Owner</option>
                            </select>
                            <button
                              type="button"
                              onClick={() =>
                                handleRemoveClientMember(member)
                              }
                              disabled={clientMemberActionId === member.id}
                              className="h-8 rounded-lg border border-red-200 px-2.5 text-xs font-medium text-red-600 disabled:cursor-not-allowed disabled:text-gray-400"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="px-3 py-3 text-sm text-gray-500">
                        No client members have been added yet.
                      </p>
                    )}
                  </div>

                  {selectedClientWorkspaceMemberInvites.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                      Pending access invites
                      </p>
                      {selectedClientWorkspaceMemberInvites.map(invite => (
                        <div
                          key={invite.id}
                          className="flex flex-col gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <span className="break-all text-sm text-gray-700">
                            {invite.email}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              handleRemoveClientInvite(invite)
                            }
                            disabled={Boolean(clientAccessAction)}
                            className="w-fit text-xs font-medium text-red-600 underline underline-offset-2 disabled:text-gray-400"
                          >
                            Revoke invitation
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              </div>

              <div className="rounded-xl border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--decisionate-brand-primary-text)]">
                      Client handoff
                    </h3>

                    <p className="mt-1 text-sm text-[var(--decisionate-brand-primary-text)]">
                      Copy a short sign-in note when handing a client workspace to a client.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleCopyClientHandoffNote}
                    disabled={!organization}
                    className="w-full shrink-0 rounded-xl bg-[var(--decisionate-brand-primary)] px-4 py-2 text-sm font-medium text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 md:w-auto"
                  >
                    Copy Handoff Note
                  </button>
                </div>

                {handoffStatus && (
                  <p
                    role="status"
                    aria-live="polite"
                    className="mt-3 whitespace-pre-line break-words text-sm font-medium text-[var(--decisionate-brand-primary-text)]"
                  >
                    {handoffStatus}
                  </p>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {!isClientPortalUser && (
      <div className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-xl font-semibold">
          Workspace Members
        </h2>

        <p className="mt-1 text-sm text-gray-500">
          Invite and manage members of this workspace.
        </p>

        {(memberError || inviteError) && (
          <button
            type="button"
            onClick={handleRetryOrganizationAccess}
            disabled={accessRetrying}
            className="mt-4 inline-flex h-9 items-center justify-center rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
          >
            {accessRetrying
              ? "Retrying access data..."
              : "Retry access data"}
          </button>
        )}

        <div className="mt-5 rounded-xl border border-gray-100 bg-gray-50 p-4">
          <h3 className="text-sm font-semibold text-gray-900">
            Invite a teammate by email
          </h3>

          <p className="mt-1 text-sm text-gray-500">
            Invite a teammate to access this workspace.
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <input
              aria-label="Teammate email"
              type="email"
              value={memberInviteEmail}
                  onChange={(event) => {
                    setMemberInviteEmail(event.target.value)
                    setInviteError("")
                  }}
                  placeholder="teammate@example.com"
                  disabled={!organization || !canConfigureWorkspace}
              className="h-10 rounded-xl border px-3 text-sm disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
            />

            <button
              type="button"
              onClick={handleInviteMember}
              disabled={
                !organization ||
                !canConfigureWorkspace ||
                !memberInviteEmail.trim()
              }
              className="h-10 w-full rounded-xl bg-[var(--decisionate-brand-primary)] px-4 text-sm font-medium text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 md:w-auto"
            >
              Invite Member
            </button>
          </div>

          {pendingMemberInvites.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Pending teammate invites
              </p>
              {pendingMemberInvites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="break-all text-sm text-gray-700">
                    {invite.email}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      handleRemovePendingMemberInvite(invite)
                    }
                    className="w-fit text-xs font-medium text-red-600 underline underline-offset-2"
                  >
                    Remove invite
                  </button>
                </div>
              ))}
            </div>
          )}

          {inviteError && (
            <p
              role="alert"
              className="mt-3 text-sm font-medium text-red-600"
            >
              {inviteError}
            </p>
          )}
        </div>

        {memberError && (
          <p
            role="alert"
            className="mt-3 text-sm font-medium text-red-600"
          >
            {memberError}
          </p>
        )}

        <div className="mt-5 divide-y divide-gray-100 rounded-xl border border-gray-100">
          {agencyWorkspaceMembers.length > 0 ? (
            agencyWorkspaceMembers.map((member) => (
              <div
                key={`${member.organization_id}-${member.id}`}
                className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium text-gray-900">
                    {member.email ||
                      (member.clerk_user_id === userId
                        ? fullName || "Current user"
                        : "Email unavailable")}
                  </p>

                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center md:shrink-0">
                  {member.role === "owner" &&
                  member.clerk_user_id === organization?.owner_user_id ? (
                    <span className="w-fit rounded-full border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] px-3 py-1 text-xs font-medium text-[var(--decisionate-brand-primary-text)]">
                      Owner
                    </span>
                  ) : (
                    <>
                      <select
                        aria-label={`Role for ${member.email || "member"}`}
                        value={member.role === "owner" ? "owner" : "member"}
                        onChange={(event) =>
                          handleUpdateMemberRole(
                            member,
                            event.target.value
                          )
                        }
                        disabled={memberActionId === member.id}
                        className="h-9 w-full rounded-lg border border-gray-200 px-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 sm:w-auto"
                      >
                        <option value="owner">
                          Owner
                        </option>
                        <option value="member">
                          Member
                        </option>
                      </select>

                      <button
                        type="button"
                        onClick={() =>
                          handleRemoveMember(
                            member
                          )
                        }
                        disabled={memberActionId === member.id}
                        className="h-9 w-full rounded-lg border border-red-200 px-3 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400 sm:w-auto"
                      >
                        {memberActionId === member.id
                          ? "Saving..."
                          : "Remove"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))
          ) : (
            <p className="px-4 py-3 text-sm text-gray-500">
              No workspace members have been added yet.
            </p>
          )}
        </div>
      </div>
      )}

      {clientWorkspaceDeleteTarget && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-950/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-client-workspace-title"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void handleDeleteClientWorkspace()
            }}
            className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl sm:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
                  <AlertTriangle size={19} />
                </span>
                <div className="min-w-0">
                  <h2
                    id="delete-client-workspace-title"
                    className="text-lg font-semibold text-gray-900"
                  >
                    Delete client workspace?
                  </h2>
                  <p className="mt-1 break-words text-sm text-gray-600">
                    This permanently removes {clientWorkspaceDeleteTarget.name}, its users&apos; access, invitations, datasets, decisions, connections, reports, and preferences.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCloseDeleteClientWorkspace}
                disabled={deletingClientWorkspace}
                aria-label="Close delete workspace confirmation"
                className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X size={18} />
              </button>
            </div>

            <label
              htmlFor="delete-client-workspace-confirmation"
              className="mt-5 block text-sm font-medium text-gray-700"
            >
              Type <span className="font-semibold text-gray-900">{clientWorkspaceDeleteTarget.name}</span> to confirm
            </label>
            <input
              id="delete-client-workspace-confirmation"
              autoFocus
              type="text"
              value={clientWorkspaceDeleteConfirmation}
              onChange={(event) => {
                setClientWorkspaceDeleteConfirmation(event.target.value)
                setClientWorkspaceDeleteError("")
              }}
              disabled={deletingClientWorkspace}
              className="mt-2 h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100 disabled:cursor-not-allowed disabled:bg-gray-50"
              spellCheck={false}
            />

            {clientWorkspaceDeleteError && (
              <p role="alert" className="mt-3 text-sm font-medium text-red-600">
                {clientWorkspaceDeleteError}
              </p>
            )}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={handleCloseDeleteClientWorkspace}
                disabled={deletingClientWorkspace}
                className="h-10 rounded-xl border border-gray-200 px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  deletingClientWorkspace ||
                  clientWorkspaceDeleteConfirmation.trim() !==
                    clientWorkspaceDeleteTarget.name.trim()
                }
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-200"
              >
                <Trash2 size={15} />
                {deletingClientWorkspace
                  ? "Deleting..."
                  : "Permanently Delete"}
              </button>
            </div>
          </form>
        </div>
      )}

    </div>
  )
}

function BrandColorField({
  label,
  value,
  fallbackColor,
  disabled,
  onChange,
}: {
  label: string
  value: string
  fallbackColor: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  const valid = isValidBrandColor(value)
  const fieldId =
    `workspace-${label.toLowerCase().replaceAll(" ", "-")}`
  const errorId = `${fieldId}-error`

  return (
    <div>
      <label
        htmlFor={fieldId}
        className="mb-2 block text-sm font-medium text-gray-600"
      >
        {label}
      </label>

      <div className="flex gap-2">
        <input
          type="color"
          value={valid ? value : fallbackColor}
          onChange={(event) => {
            onChange(
              event.target.value.toUpperCase()
            )
          }}
          aria-label={`${label} picker`}
          disabled={disabled}
          className="h-12 w-16 shrink-0 rounded-xl border p-1 disabled:cursor-not-allowed disabled:bg-gray-50"
        />

        <input
          id={fieldId}
          type="text"
          value={value}
          onChange={(event) => {
            onChange(
              event.target.value.toUpperCase()
            )
          }}
          onBlur={() => {
            const normalizedValue =
              normalizeBrandColorInput(value)

            if (normalizedValue !== value) {
              onChange(normalizedValue)
            }
          }}
          placeholder={fallbackColor}
          maxLength={7}
          spellCheck={false}
          aria-invalid={!valid}
          aria-describedby={!valid ? errorId : undefined}
          disabled={disabled}
          className={`h-12 min-w-0 flex-1 rounded-xl border px-3 font-mono text-sm uppercase disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 ${
            valid
              ? "border-gray-200"
              : "border-red-300 bg-red-50"
          }`}
        />
      </div>

      {!valid && (
        <p
          id={errorId}
          role="alert"
          className="mt-1.5 text-xs font-medium text-red-600"
        >
          Enter a six-digit hex color such as {fallbackColor}.
        </p>
      )}
    </div>
  )
}

function normalizeBrandColorInput(
  value: string
) {
  const cleanValue =
    value.trim().toUpperCase()

  return /^[0-9A-F]{6}$/.test(cleanValue)
    ? `#${cleanValue}`
    : cleanValue
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>(
    (resolve, reject) => {
      const reader = new FileReader()

      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result)
          return
        }

        reject(
          new Error("Logo file could not be read.")
        )
      }

      reader.onerror = () => {
        reject(
          reader.error ??
            new Error("Logo file could not be read.")
        )
      }

      reader.readAsDataURL(file)
    }
  )
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  const kilobytes = bytes / 1024

  if (kilobytes < 1024) {
    return `${Math.round(kilobytes)} KB`
  }

  return `${(kilobytes / 1024).toFixed(1)} MB`
}

function cleanPendingClientInviteEmail(
  email: unknown
) {
  if (typeof email !== "string") {
    return ""
  }

  const cleanEmail =
    email.trim().toLowerCase()

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
      cleanEmail
    )
  ) {
    return ""
  }

  return cleanEmail
}
