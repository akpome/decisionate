"use client"

import {
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
  removeOrganizationInvite,
  removeOrganizationMember,
  updateOrganizationMemberRole,
  updateMyOrganization,
  type OrganizationInviteRecord,
  type OrganizationMemberRecord,
  type OrganizationRecord,
  type OrganizationWorkspaceRecord,
} from "@/lib/api"

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
   Settings Client Form For Profile Display And Workspace Rename
========================= */

export function SettingsClient({
  userId,
  fullName,
  emailAddress,
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
    useState("#2563EB")
  const [accentColor, setAccentColor] =
    useState("#14B8A6")
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
  const [memberActionId, setMemberActionId] =
    useState<number | null>(null)
  const [saveError, setSaveError] =
    useState("")
  const [memberError, setMemberError] =
    useState("")
  const [inviteError, setInviteError] =
    useState("")
  const [handoffStatus, setHandoffStatus] =
    useState("")
  const [saved, setSaved] =
    useState(false)

  const agencyDisplayName =
    reportDisplayName.trim() ||
    organizationName.trim() ||
    organization?.name ||
    "your agency"
  const organizationChanged =
    organizationName.trim() !==
      (organization?.name ?? "") ||
    logoUrl.trim() !==
      (organization?.logo_url ?? "") ||
    primaryColor.trim() !==
      (organization?.primary_color ?? "#2563EB") ||
    accentColor.trim() !==
      (organization?.accent_color ?? "#14B8A6") ||
    reportDisplayName.trim() !==
      (organization?.report_display_name ?? "")
  const clientMemberCount =
    organizationMembers.filter(
      (member) =>
        member.role === "client"
    ).length
  const sharedWorkspaces =
    organizationWorkspaces.filter(
      (workspace) =>
        workspace.owner_user_id !== userId
    )
  const sharedWorkspaceCount =
    sharedWorkspaces.length
  const isClientPortalUser =
    !organization &&
    sharedWorkspaceCount > 0
  const canAddMember =
    Boolean(organization) &&
    Boolean(memberUserId.trim()) &&
    !addingMember

  useEffect(() => {
    let ignoreResult = false

    async function loadOrganization() {
      setLoadingOrganization(true)
      setSaveError("")

      try {
        const [
          organizationData,
          memberData,
          workspaceData,
          inviteData,
        ] = await Promise.all([
          getMyOrganization(
            userId
          ),
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

        if (!ignoreResult) {
          setOrganization(organizationData)
          setOrganizationName(organizationData?.name ?? "")
          setLogoUrl(organizationData?.logo_url ?? "")
          setPrimaryColor(
            organizationData?.primary_color ?? "#2563EB"
          )
          setAccentColor(
            organizationData?.accent_color ?? "#14B8A6"
          )
          setReportDisplayName(
            organizationData?.report_display_name ?? ""
          )
          setOrganizationMembers(memberData)
          setOrganizationWorkspaces(workspaceData)
          setPendingClientInvites(inviteData)
        }
      } catch (error) {
        console.error(error)

        if (!ignoreResult) {
          setSaveError(
            getSettingsErrorMessage(
              error,
              "Unable to load organization settings."
            )
          )
        }
      } finally {
        if (!ignoreResult) {
          setLoadingOrganization(false)
        }
      }
    }

    void loadOrganization()

    return () => {
      ignoreResult = true
    }
  }, [userId])

  async function handleSaveOrganization() {
    if (
      savingOrganization ||
      !organizationChanged ||
      !organizationName.trim()
    ) {
      return
    }

    setSavingOrganization(true)
    setSaveError("")
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
      const memberData =
        await getOrganizationMembers(
          userId
        )
      const workspaceData =
        await getOrganizationWorkspaces(
          userId
        )
      const inviteData =
        await getOrganizationInvites(
          userId
        )

      setOrganization(data)
      setOrganizationName(data.name)
      setLogoUrl(data.logo_url ?? "")
      setPrimaryColor(
        data.primary_color ?? "#2563EB"
      )
      setAccentColor(
        data.accent_color ?? "#14B8A6"
      )
      setReportDisplayName(
        data.report_display_name ?? ""
      )
      setOrganizationMembers(memberData)
      setOrganizationWorkspaces(workspaceData)
      setPendingClientInvites(inviteData)
      window.dispatchEvent(
        new CustomEvent(
          "decisionate:organization-updated",
          {
            detail: data,
          }
        )
      )
      setSaved(true)

      setTimeout(() => {
        setSaved(false)
      }, 3000)
    } catch (error) {
      console.error(error)
      setSaveError(
        getSettingsErrorMessage(
          error,
          "Organization could not be saved."
        )
      )
    } finally {
      setSavingOrganization(false)
    }
  }

  async function handleAddMember() {
    if (!canAddMember) return

    setAddingMember(true)
    setMemberError("")

    try {
      await addOrganizationMember(
        {
          clerk_user_id: memberUserId.trim(),
          role: memberRole,
        },
        userId
      )

      const memberData =
        await getOrganizationMembers(
          userId
        )
      const workspaceData =
        await getOrganizationWorkspaces(
          userId
        )

      setOrganizationMembers(memberData)
      setOrganizationWorkspaces(workspaceData)
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
      `Hi — ${agencyDisplayName} has added you to Decisionate as a client user.\n\n` +
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

      <div>
        <h1 className="text-3xl font-bold">
          Settings
        </h1>

        <p className="mt-2 text-gray-500">
          {isClientPortalUser
            ? "Review the client workspaces your agency has shared with you."
            : "Manage your agency profile, client access, and workspace handoff settings."}
        </p>
      </div>

      {/* =========================
          Agency Client Portal Overview For Go To Market Positioning
      ========================= */}

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold">
              {isClientPortalUser
                ? "Client Portal Access"
                : "Agency Client Portal"}
            </h2>

            <p className="mt-1 text-sm text-gray-500">
              {isClientPortalUser
                ? "Your agency has invited you into branded workspaces where you can use Decisionate directly."
                : "Set up Decisionate as a managed client workspace your agency can operate and hand over to client users."}
            </p>
          </div>

          <span className="w-fit rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
            {isClientPortalUser
              ? "Client Portal"
              : "Agency MVP"}
          </span>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <AgencyPortalStep
            title={
              isClientPortalUser
                ? "Agency-managed"
                : "Agency profile"
            }
            description={
              isClientPortalUser
                ? "The agency manages branding, setup, and workspace access for you."
                : "Use your agency name as the anchor for workspace ownership and client handoff."
            }
            status={
              isClientPortalUser
                ? "Active"
                : organization
                  ? "Started"
                  : "Needs setup"
            }
          />

          <AgencyPortalStep
            title={
              isClientPortalUser
                ? "Your role"
                : "Client access"
            }
            description={
              isClientPortalUser
                ? "You can work in the shared client workspaces assigned to this account."
                : "Invite client users with the Client role so they can use their workspace directly."
            }
            status={
              isClientPortalUser
                ? "Client"
                : `${clientMemberCount} client${clientMemberCount === 1 ? "" : "s"}`
            }
          />

          <AgencyPortalStep
            title="Workspace handoff"
            description={
              isClientPortalUser
                ? "Use the sidebar switcher to move between workspaces shared with you."
                : "Client and agency workspaces appear in the sidebar switcher based on membership."
            }
            status={`${sharedWorkspaceCount} shared`}
          />
        </div>
      </div>

      {/* =========================
          Read Only Clerk Profile Summary Section
      ========================= */}

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="mb-6 text-xl font-semibold">
          Profile
        </h2>

        <div className="space-y-5">
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-600">
              Full Name
            </label>

            <input
              type="text"
              value={fullName}
              readOnly
              className="w-full rounded-xl border bg-gray-50 p-3 text-gray-700"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-600">
              Email Address
            </label>

            <input
              type="email"
              value={emailAddress}
              readOnly
              className="w-full rounded-xl border bg-gray-50 p-3 text-gray-700"
            />
          </div>
        </div>
      </div>

      {/* =========================
          Workspace Organization Rename Section For Agency Readiness
      ========================= */}

      {!isClientPortalUser && (
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">
              Agency Profile
            </h2>

            <p className="mt-1 text-sm text-gray-500">
              This name anchors the agency workspace clients will recognize when they are invited into the app.
            </p>
          </div>

          {saved && (
            <span className="rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
              Saved
            </span>
          )}
        </div>

        <div className="space-y-5">
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-600">
              Agency Name
            </label>

            <input
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
                  ? "Loading organization..."
                  : "Decisionate Workspace"
              }
              disabled={loadingOrganization}
              className="w-full rounded-xl border p-3 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-600">
              Logo URL
            </label>

            <input
              type="url"
              value={logoUrl}
              onChange={(event) => {
                setLogoUrl(
                  event.target.value
                )
                setSaveError("")
                setSaved(false)
              }}
              placeholder="https://example.com/logo.png"
              disabled={loadingOrganization}
              className="w-full rounded-xl border p-3 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
            />
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-600">
                Primary Color
              </label>

              <input
                type="color"
                value={primaryColor}
                onChange={(event) => {
                  setPrimaryColor(
                    event.target.value.toUpperCase()
                  )
                  setSaveError("")
                  setSaved(false)
                }}
                disabled={loadingOrganization}
                className="h-12 w-full rounded-xl border p-1 disabled:cursor-not-allowed disabled:bg-gray-50"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-600">
                Accent Color
              </label>

              <input
                type="color"
                value={accentColor}
                onChange={(event) => {
                  setAccentColor(
                    event.target.value.toUpperCase()
                  )
                  setSaveError("")
                  setSaved(false)
                }}
                disabled={loadingOrganization}
                className="h-12 w-full rounded-xl border p-1 disabled:cursor-not-allowed disabled:bg-gray-50"
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-600">
              Report Display Name
            </label>

            <input
              type="text"
              value={reportDisplayName}
              onChange={(event) => {
                setReportDisplayName(
                  event.target.value
                )
                setSaveError("")
                setSaved(false)
              }}
              placeholder={organizationName || "Agency name shown on client reports"}
              disabled={loadingOrganization}
              className="w-full rounded-xl border p-3 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
            />
          </div>

          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Client-facing preview
            </p>

            <div className="mt-3 flex items-center gap-3">
              <div
                className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl text-sm font-bold text-white"
                style={{
                  backgroundColor: primaryColor,
                }}
              >
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  (reportDisplayName || organizationName || "A")
                    .charAt(0)
                    .toUpperCase()
                )}
              </div>

              <div>
                <p className="font-medium text-gray-900">
                  {reportDisplayName ||
                    organizationName ||
                    "Agency Brand"}
                </p>

                <p
                  className="text-sm"
                  style={{
                    color: accentColor,
                  }}
                >
                  Client decision workspace
                </p>
              </div>
            </div>
          </div>

          {saveError && (
            <p className="text-sm font-medium text-red-600">
              {saveError}
            </p>
          )}

          <button
            type="button"
            onClick={handleSaveOrganization}
            disabled={
              loadingOrganization ||
              savingOrganization ||
              !organizationChanged ||
              !organizationName.trim()
            }
            className="rounded-xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {savingOrganization
              ? "Saving..."
              : "Save Changes"}
          </button>
        </div>
      </div>
      )}

      {/* =========================
          Workspace Access Summary For Personal And Shared Organizations
      ========================= */}

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold">
          Client Workspace Access
        </h2>

        <p className="mt-1 text-sm text-gray-500">
          {isClientPortalUser
            ? "Workspaces your agency has shared with this account."
            : "Workspaces available in the sidebar switcher for agency staff and client users."}
        </p>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {!isClientPortalUser && (
            <WorkspaceAccessRow
              name={
                reportDisplayName ||
                organization?.name ||
                fullName ||
                "My Workspace"
              }
              subtitle={
                reportDisplayName && organization?.name
                  ? organization.name
                  : undefined
              }
              role="owner"
              currentUser
              logoUrl={logoUrl}
              brandColor={primaryColor}
            />
          )}

          {sharedWorkspaces.map((workspace) => (
              <WorkspaceAccessRow
                key={workspace.owner_user_id}
                name={
                  workspace.report_display_name ||
                  workspace.name
                }
                subtitle={
                  workspace.report_display_name
                    ? workspace.name
                    : undefined
                }
                role={workspace.role}
                logoUrl={workspace.logo_url}
                brandColor={workspace.primary_color}
              />
          ))}
        </div>
      </div>

      {/* =========================
          Workspace Members Management Section For Future Agency Roles
      ========================= */}

      {!isClientPortalUser && (
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold">
          Client & Team Access
        </h2>

        <p className="mt-1 text-sm text-gray-500">
          Add agency teammates as members or client users with the Client role. For this MVP, clients should sign in once, then you can add their Clerk user ID.
        </p>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <HandoffChecklistItem
            title="Agency profile"
            description="Brand and workspace name are saved."
            ready={Boolean(organization)}
          />

          <HandoffChecklistItem
            title="Client user"
            description="At least one client role is assigned."
            ready={clientMemberCount > 0}
          />

          <HandoffChecklistItem
            title="Portal handoff"
            description="Copy a client-ready sign-in note."
            ready={Boolean(organization)}
          />
        </div>

        <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-blue-950">
                Client portal handoff
              </h3>

              <p className="mt-1 text-sm text-blue-700">
                Send clients a short note after their Client role is added so they know where to sign in and what to expect.
              </p>
            </div>

            <button
              type="button"
              onClick={handleCopyClientHandoffNote}
              disabled={!organization}
              className="shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-200"
            >
              Copy Handoff Note
            </button>
          </div>

          {handoffStatus && (
            <p className="mt-3 whitespace-pre-line text-sm font-medium text-blue-800">
              {handoffStatus}
            </p>
          )}
        </div>

        <div className="mt-5 rounded-xl border border-gray-100 bg-gray-50 p-4">
          <h3 className="text-sm font-semibold text-gray-900">
            Pending client invites
          </h3>

          <p className="mt-1 text-sm text-gray-500">
            Track client emails while you wait for them to sign in. Once they sign in, add their Clerk user ID below and remove the email from this list.
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <input
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
              className="h-10 rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-400"
            >
              Track Invite
            </button>
          </div>

          {inviteError && (
            <p className="mt-3 text-sm font-medium text-red-600">
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
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {invite.email}
                    </p>

                    <p className="text-xs text-gray-500">
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
                    className="w-fit rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
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
            type="text"
            value={memberUserId}
            onChange={(event) => {
              setMemberUserId(
                event.target.value
              )
              setMemberError("")
            }}
            placeholder="Client or teammate Clerk user ID"
            disabled={!organization || addingMember}
            className="h-10 rounded-xl border px-3 text-sm disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
          />

          <select
            value={memberRole}
            onChange={(event) =>
              setMemberRole(event.target.value)
            }
            disabled={!organization || addingMember}
            className="h-10 rounded-xl border px-3 text-sm disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
          >
            <option value="member">Member</option>
            <option value="client">Client</option>
          </select>

          <button
            type="button"
            onClick={handleAddMember}
            disabled={!canAddMember}
            className="h-10 rounded-xl border border-blue-200 px-4 text-sm font-medium text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
          >
            {addingMember
              ? "Adding..."
              : "Add Member"}
          </button>
        </div>

        {memberError && (
          <p className="mt-3 text-sm font-medium text-red-600">
            {memberError}
          </p>
        )}

        <p className="mt-3 text-xs text-gray-500">
          Use Member for agency teammates. Use Client when handing over access to a client user.
        </p>

        <div className="mt-5 divide-y divide-gray-100 rounded-xl border border-gray-100">
          {organizationMembers.length > 0 ? (
            organizationMembers.map((member) => (
              <div
                key={`${member.organization_id}-${member.clerk_user_id}`}
                className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {member.clerk_user_id === userId
                      ? fullName || "Current user"
                      : member.clerk_user_id}
                  </p>

                  <p className="truncate text-xs text-gray-500">
                    {member.clerk_user_id}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {member.role === "owner" ? (
                    <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                      Owner
                    </span>
                  ) : (
                    <>
                      <select
                        value={member.role}
                        onChange={(event) =>
                          handleUpdateMemberRole(
                            member,
                            event.target.value
                          )
                        }
                        disabled={memberActionId === member.id}
                        className="h-9 rounded-lg border border-gray-200 px-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
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
                        className="h-9 rounded-lg border border-red-200 px-3 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
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
              Save an agency name to initialize client and team access.
            </p>
          )}
        </div>
      </div>
      )}

      {/* =========================
          Workspace Danger Zone Placeholder For Future Data Controls
      ========================= */}

      {!isClientPortalUser && (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6">
        <h2 className="mb-4 text-xl font-semibold text-red-600">
          Danger Zone
        </h2>

        <p className="mb-6 text-sm text-red-500">
          Permanently delete your workspace and associated data.
        </p>

        <button className="rounded-xl border border-red-300 px-5 py-3 text-sm font-medium text-red-600 transition hover:bg-red-100">
          Delete Workspace
        </button>
      </div>
      )}
    </div>
  )
}

function AgencyPortalStep({
  title,
  description,
  status,
}: {
  title: string
  description: string
  status: string
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-900">
          {title}
        </h3>

        <span className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600">
          {status}
        </span>
      </div>

      <p className="mt-2 text-sm text-gray-500">
        {description}
      </p>
    </div>
  )
}

function HandoffChecklistItem({
  title,
  description,
  ready,
}: {
  title: string
  description: string
  ready: boolean
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-900">
          {title}
        </h3>

        <span
          className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
            ready
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-amber-200 bg-amber-50 text-amber-700"
          }`}
        >
          {ready ? "Ready" : "Needed"}
        </span>
      </div>

      <p className="mt-2 text-sm text-gray-500">
        {description}
      </p>
    </div>
  )
}

function WorkspaceAccessRow({
  name,
  subtitle,
  role,
  currentUser = false,
  logoUrl,
  brandColor,
}: {
  name: string
  subtitle?: string
  role: string
  currentUser?: boolean
  logoUrl?: string | null
  brandColor?: string | null
}) {
  return (
    <div className="rounded-xl border border-gray-100 px-4 py-3">
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl text-sm font-bold text-white"
          style={{
            backgroundColor:
              brandColor || "#2563EB",
          }}
        >
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            name.charAt(0).toUpperCase()
          )}
        </div>

        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-gray-900">
            {name}
          </p>

          {subtitle && (
            <p className="truncate text-xs text-gray-500">
              {subtitle}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
              {formatRoleLabel(role)}
            </span>

            {currentUser && (
              <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600">
                Current account
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
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
