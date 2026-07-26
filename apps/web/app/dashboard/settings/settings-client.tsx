"use client"

import {
  CircleAlert,
  CircleCheck,
  RotateCcw,
} from "lucide-react"
import {
  type ChangeEvent,
  useEffect,
  useState,
} from "react"

import {
  addOrganizationInvite,
  addOrganizationMember,
  createOrganization,
  getMyOrganization,
  getOrganizationInvites,
  getOrganizationMembers,
  getOrganizationWorkspaces,
  getAIStatus,
  removeOrganizationInvite,
  removeOrganizationMember,
  updateOrganizationMemberRole,
  updateMyOrganization,
  type OrganizationInviteRecord,
  type OrganizationMemberRecord,
  type OrganizationRecord,
  type OrganizationWorkspaceRecord,
  type AIStatus,
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
import { DashboardPageHeader } from "@/features/dashboard/components/dashboard-page-header"

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
}: SettingsClientProps) {
  const [organization, setOrganization] =
    useState<OrganizationRecord | null>(null)
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
  const [memberUserId, setMemberUserId] =
    useState("")
  const [memberRole, setMemberRole] =
    useState("member")
  const [inviteEmail, setInviteEmail] =
    useState("")
  const [pendingClientInvites, setPendingClientInvites] =
    useState<OrganizationInviteRecord[]>([])
  const [loadingOrganization, setLoadingOrganization] =
    useState(true)
  const [savingOrganization, setSavingOrganization] =
    useState(false)
  const [addingMember, setAddingMember] =
    useState(false)
  const [accessRetrying, setAccessRetrying] =
    useState(false)
  const [organizationLoadRetryKey, setOrganizationLoadRetryKey] =
    useState(0)
  const [memberActionId, setMemberActionId] =
    useState<number | null>(null)
  const [organizationLoadError, setOrganizationLoadError] =
    useState("")
  const [aiStatus, setAiStatus] =
    useState<AIStatus | null>(null)
  const [aiStatusError, setAiStatusError] =
    useState("")
  const [aiStatusRetryKey, setAiStatusRetryKey] =
    useState(0)
  const [saveError, setSaveError] =
    useState("")
  const [logoUploadError, setLogoUploadError] =
    useState("")
  const [memberError, setMemberError] =
    useState("")
  const [inviteError, setInviteError] =
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
    !organization &&
    !organizationLoadError &&
    sharedWorkspaceCount > 0
  const canAddMember =
    Boolean(organization) &&
    Boolean(memberUserId.trim()) &&
    !addingMember

  useEffect(() => {
    let ignoreResult = false

    async function loadOrganization() {
      setLoadingOrganization(true)
      setOrganizationLoadError("")
      setSaveError("")
      setMemberError("")
      setInviteError("")
      setAiStatusError("")

      const [
        organizationResult,
        workspaceResult,
        aiStatusResult,
      ] = await Promise.allSettled([
        getMyOrganization(
          userId
        ),
        getOrganizationWorkspaces(
          userId
        ),
        getAIStatus(
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
            setPendingClientInvites([])
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

        if (
          aiStatusResult.status ===
          "fulfilled"
        ) {
          setAiStatus(
            aiStatusResult.value
          )
        } else {
          setAiStatusError(
            getSettingsErrorMessage(
              aiStatusResult.reason,
              "Unable to load AI readiness."
            )
          )
        }

        if (inviteResult?.status === "fulfilled") {
          setPendingClientInvites(
            inviteResult.value
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
  }, [aiStatusRetryKey, organizationLoadRetryKey, userId])

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
        setPendingClientInvites(
          inviteResult.value
        )
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
      setPendingClientInvites(
        inviteResult.value
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

  async function handleAddMember() {
    if (!canAddMember) return

    setAddingMember(true)
    setMemberError("")

    try {
      try {
        await addOrganizationMember(
          {
            clerk_user_id: memberUserId.trim(),
            role: memberRole,
          },
          userId
        )
        setMemberUserId("")
        setMemberRole("member")
      } catch (error) {
        console.error(error)
        setMemberError(
          getSettingsErrorMessage(
            error,
            "Member could not be added."
          )
        )
        return
      }

      const [memberResult, workspaceResult] =
        await Promise.allSettled([
          getOrganizationMembers(userId),
          getOrganizationWorkspaces(userId),
        ])

      if (memberResult.status === "fulfilled") {
        setOrganizationMembers(
          memberResult.value
        )
        setMemberError("")
      } else {
        setMemberError(
          `Member added, but the member list could not be refreshed. ${getSettingsErrorMessage(
            memberResult.reason,
            "Retry access data."
          )}`
        )
      }

      if (workspaceResult.status === "fulfilled") {
        setOrganizationWorkspaces(
          workspaceResult.value
        )
        setSaveError("")
      } else {
        setSaveError(
          "Member added, but workspace access data could not be refreshed."
        )
      }
    } finally {
      setAddingMember(false)
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
      "Once you sign in, your shared client workspace will open in the sidebar. You can review dashboards, datasets, reports, forecasts, alerts, and decisions from that workspace."

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

  async function handleTrackClientInvite() {
    if (!organization) return

    const cleanEmail =
      cleanPendingClientInviteEmail(
        inviteEmail
      )

    if (!cleanEmail) {
      setInviteError(
        "Enter a valid client email to track."
      )
      return
    }

    if (
      pendingClientInvites.some(
        (invite) => invite.email === cleanEmail
      )
    ) {
      setInviteError(
        "That client email is already being tracked."
      )
      return
    }

    try {
      const invite =
        await addOrganizationInvite(
          {
            email: cleanEmail,
            role: "client",
          },
          userId
        )

      setPendingClientInvites(
        (currentInvites) => [
          ...currentInvites.filter(
            (currentInvite) =>
              currentInvite.id !== invite.id &&
              currentInvite.email !== invite.email
          ),
          invite,
        ]
      )
      setInviteEmail("")
      setInviteError("")
    } catch (error) {
      console.error(error)
      setInviteError(
        getSettingsErrorMessage(
          error,
          "Client invite could not be tracked."
        )
      )
    }
  }

  async function handleRemovePendingClientInvite(
    invite: OrganizationInviteRecord
  ) {
    if (!organization) return

    try {
      await removeOrganizationInvite(
        invite.id,
        userId
      )

      setPendingClientInvites(
        (currentInvites) =>
          currentInvites.filter(
            (currentInvite) =>
              currentInvite.id !== invite.id
          )
      )
      setInviteError("")
    } catch (error) {
      console.error(error)
      setInviteError(
        getSettingsErrorMessage(
          error,
          "Client invite could not be removed."
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
      member.role === "owner" ||
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
      member.role === "owner" ||
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

  return (
    <div className="space-y-8">
      {/* =========================
          Settings Page Header For Account And Workspace Management
      ========================= */}

      <DashboardPageHeader
        title="Settings"
        description={
          isClientPortalUser
            ? "Review the workspaces that have been shared with you."
            : "Manage your workspace profile, branding, team access, and optional client handoff settings."
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
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold">
              Workspace Profile
            </h2>

            <p className="mt-1 text-sm text-gray-500">
              This name anchors the workspace people will recognize in the app, reports, and shared dashboards.
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
        <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold">
                Decision Intelligence
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                AI analysis uses recorded decision outcomes and lessons as evidence when a provider is configured.
              </p>
            </div>

            {aiStatusError ? (
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
                <CircleAlert size={14} />
                Status unavailable
              </span>
            ) : aiStatus === null ? (
              <span className="inline-flex w-fit items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-600">
                Checking AI...
              </span>
            ) : aiStatus.configured ? (
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
                <CircleCheck size={14} />
                AI ready
              </span>
            ) : (
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
                <CircleAlert size={14} />
                Rules fallback
              </span>
            )}
          </div>

          {aiStatusError ? (
            <div
              role="status"
              className="mt-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between"
            >
              <span>
                AI readiness is temporarily unavailable. Analysis will continue using the configured fallback rules.
              </span>
              <button
                type="button"
                onClick={() =>
                  setAiStatusRetryKey(
                    currentKey => currentKey + 1
                  )
                }
                disabled={loadingOrganization}
                className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-amber-300 bg-white px-3 text-xs font-medium text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loadingOrganization
                  ? "Retrying..."
                  : "Retry AI status"}
              </button>
            </div>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Provider
                </p>
                <p className="mt-1 text-sm font-semibold text-gray-800">
                  {aiStatus?.provider || "Checking..."}
                </p>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Model
                </p>
                <p className="mt-1 truncate text-sm font-semibold text-gray-800">
                  {aiStatus?.model || "Deterministic rules"}
                </p>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Learning input
                </p>
                <p className="mt-1 text-sm font-semibold text-gray-800">
                  Outcomes + lessons
                </p>
              </div>
            </div>
          )}
        </section>
      )}

      {/* =========================
          Workspace Members Management Section For Team And Client Roles
      ========================= */}

      {!isClientPortalUser && (
      <div className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-xl font-semibold">
          Team & Client Access
        </h2>

        <p className="mt-1 text-sm text-gray-500">
          Add teammates with the Member role. Use the Client role only for external users who should review a shared workspace without managing data setup.
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

        <div className="mt-5 rounded-xl border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-[var(--decisionate-brand-primary-text)]">
                Optional client handoff
              </h3>

              <p className="mt-1 text-sm text-[var(--decisionate-brand-primary-text)]">
                Use this when you give a client access to a shared workspace and want a short sign-in note.
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

        <div className="mt-5 rounded-xl border border-gray-100 bg-gray-50 p-4">
          <h3 className="text-sm font-semibold text-gray-900">
            Optional client invite tracking
          </h3>

          <p className="mt-1 text-sm text-gray-500">
            Track client emails only when you are preparing external client access. Once they sign in, add their user ID below and remove the email from this list.
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <input
              aria-label="Client email to track"
              type="email"
              value={inviteEmail}
              onChange={(event) => {
                setInviteEmail(
                  event.target.value
                )
                setInviteError("")
              }}
              placeholder="client@example.com"
              disabled={!organization}
              className="h-10 rounded-xl border px-3 text-sm disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
            />

            <button
              type="button"
              onClick={handleTrackClientInvite}
              disabled={!organization || !inviteEmail.trim()}
              className="h-10 w-full rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-400 md:w-auto"
            >
              Track Invite
            </button>
          </div>

          {inviteError && (
            <p
              role="alert"
              className="mt-3 text-sm font-medium text-red-600"
            >
              {inviteError}
            </p>
          )}

          {pendingClientInvites.length > 0 ? (
            <div className="mt-4 divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
              {pendingClientInvites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium text-gray-900">
                      {invite.email}
                    </p>

                    <p className="break-words text-xs text-gray-500">
                      Waiting for client sign-in · {formatRoleLabel(invite.role)}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      handleRemovePendingClientInvite(
                        invite
                      )
                    }
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 transition hover:bg-gray-50 md:w-fit"
                  >
                    Mark Added
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-gray-500">
              No pending client emails tracked.
            </p>
          )}
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem_auto]">
          <input
            aria-label="Teammate or client user ID"
            type="text"
            value={memberUserId}
            onChange={(event) => {
              setMemberUserId(
                event.target.value
              )
              setMemberError("")
            }}
            placeholder="Teammate or client user ID"
            disabled={!organization || addingMember}
            className="h-10 w-full min-w-0 rounded-xl border px-3 text-sm disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
          />

          <select
            aria-label="New member role"
            value={memberRole}
            onChange={(event) =>
              setMemberRole(event.target.value)
            }
            disabled={!organization || addingMember}
            className="h-10 w-full min-w-0 rounded-xl border px-3 text-sm disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
          >
            <option value="member">Member</option>
            <option value="client">Client</option>
          </select>

          <button
            type="button"
            onClick={handleAddMember}
            disabled={!canAddMember}
            className="h-10 w-full rounded-xl border border-[var(--decisionate-brand-primary-ring)] px-4 text-sm font-medium text-[var(--decisionate-brand-primary-text)] transition hover:bg-[var(--decisionate-brand-primary-soft)] disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400 md:w-auto"
          >
            {addingMember
              ? "Adding..."
              : "Add Member"}
          </button>
        </div>

        {memberError && (
          <p
            role="alert"
            className="mt-3 text-sm font-medium text-red-600"
          >
            {memberError}
          </p>
        )}

        <p className="mt-3 text-xs text-gray-500">
          Use Member for teammates. Use Client only when handing over a shared workspace to an external client.
        </p>

        <div className="mt-5 divide-y divide-gray-100 rounded-xl border border-gray-100">
          {organizationMembers.length > 0 ? (
            organizationMembers.map((member) => (
              <div
                key={`${member.organization_id}-${member.clerk_user_id}`}
                className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium text-gray-900">
                    {member.clerk_user_id === userId
                      ? fullName || "Current user"
                      : member.clerk_user_id}
                  </p>

                  <p className="break-all text-xs text-gray-500">
                    {member.clerk_user_id}
                  </p>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center md:shrink-0">
                  {member.role === "owner" ? (
                    <span className="w-fit rounded-full border border-[var(--decisionate-brand-primary-ring)] bg-[var(--decisionate-brand-primary-soft)] px-3 py-1 text-xs font-medium text-[var(--decisionate-brand-primary-text)]">
                      Owner
                    </span>
                  ) : (
                    <>
                      <select
                        aria-label={`Role for ${member.clerk_user_id}`}
                        value={member.role}
                        onChange={(event) =>
                          handleUpdateMemberRole(
                            member,
                            event.target.value
                          )
                        }
                        disabled={memberActionId === member.id}
                        className="h-9 w-full rounded-lg border border-gray-200 px-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 sm:w-auto"
                      >
                        <option value="member">
                          Member
                        </option>
                        <option value="client">
                          Client
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
              Save a workspace name to initialize team and client access.
            </p>
          )}
        </div>
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

function formatRoleLabel(
  role: string
) {
  return role
    .replaceAll("_", " ")
    .replace(
      /\b\w/g,
      (character) => character.toUpperCase()
    )
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
