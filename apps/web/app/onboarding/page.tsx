"use client"

import {
  useEffect,
  useState,
  type FormEvent,
} from "react"
import { useRouter } from "next/navigation"
import { useClerk, useUser } from "@clerk/nextjs"
import Image from "next/image"
import Link from "next/link"
import { ArrowLeft, ArrowRight, LoaderCircle, LogOut, RefreshCw } from "lucide-react"

import {
  createOrganization,
  getOrganizationWorkspaces,
  type OrganizationCreatePayload,
} from "@/lib/api"
import {
  ThemeToggle,
} from "@/app/theme-toggle"
import { useDecisionateText } from "@/app/use-decisionate-language"
import { getSafeReturnTo, getSignInUrl, getWorkspaceReturnTo } from "@/features/auth/lib/auth-redirects"
import { chooseAuthWorkspace } from "@/features/auth/lib/auth-workspaces"
import { getActiveWorkspaceId, setActiveWorkspaceId } from "@/lib/workspace-context"

const workspaceTypes = [
  {
    value: "business",
    name: "Business",
    description: "For your own business workspace.",
  },
  {
    value: "agency",
    name: "Agency",
    description: "For an agency managing client workspaces.",
  },
] as const

type BusinessType = (typeof workspaceTypes)[number]["value"]

const countryOptions = [
  "Canada",
  "United States",
  "United Kingdom",
  "Australia",
  "New Zealand",
  "Other",
]

const industryOptions = [
  "Agriculture",
  "Construction",
  "Education",
  "Financial services",
  "Healthcare",
  "Hospitality",
  "Manufacturing",
  "Marketing and advertising",
  "Nonprofit",
  "Professional services",
  "Real estate",
  "Retail and ecommerce",
  "Technology",
  "Other",
]

const companySizeOptions = [
  "1-10",
  "11-50",
  "51-250",
  "251-1000",
  "1000+",
]

const agencyClientCountOptions = [
  "1-5",
  "6-10",
  "11-25",
  "26-50",
  "50+",
]

const roleOptions = [
  "Business owner or founder",
  "Agency owner or lead",
  "Finance",
  "Marketing",
  "Operations",
  "Analyst",
  "Other",
]

const primaryGoalOptions = [
  "Understand business performance",
  "Automate reporting",
  "Find growth opportunities",
  "Improve operational decisions",
  "Monitor outcomes and accountability",
  "Other",
]

function getOnboardingErrorMessage(
  error: unknown,
  fallbackMessage: string
) {
  return error instanceof Error &&
    error.message
    ? error.message
    : fallbackMessage
}

export default function OnboardingPage() {
  const { t } = useDecisionateText()
  const { isLoaded, isSignedIn, user } = useUser()
  const { signOut } = useClerk()
  const userEmail =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress

  const router = useRouter()

  const [organizationName, setOrganizationName] =
    useState("")
  const [firstName, setFirstName] = useState<string | null>(null)
  const [lastName, setLastName] = useState<string | null>(null)
  const [businessType, setBusinessType] =
    useState<BusinessType>("business")
  const [country, setCountry] = useState("")
  const [industry, setIndustry] = useState("")
  const [companySize, setCompanySize] = useState("")
  const [agencyClientCount, setAgencyClientCount] = useState("")
  const [role, setRole] = useState("")
  const [primaryGoal, setPrimaryGoal] = useState("")
  const [step, setStep] = useState<1 | 2>(1)

  const [loading, setLoading] =
    useState(false)
  const [
    checkingOrganization,
    setCheckingOrganization,
  ] = useState(true)
  const [existingWorkspaceFound, setExistingWorkspaceFound] =
    useState(false)
  const [errorMessage, setErrorMessage] =
    useState("")
  const [workspaceCheckFailed, setWorkspaceCheckFailed] = useState(false)
  const [checkAttempt, setCheckAttempt] = useState(0)

  const resolvedFirstName = (firstName ?? user?.firstName ?? "").trim()
  const resolvedLastName = (lastName ?? user?.lastName ?? "").trim()
  const canContinue =
    Boolean(
      resolvedFirstName &&
      resolvedLastName &&
      userEmail &&
      organizationName.trim() &&
      businessType &&
      country
    ) &&
    !loading &&
    !checkingOrganization &&
    !workspaceCheckFailed &&
    !existingWorkspaceFound
  const canCreateOrganization =
    canContinue &&
    Boolean(
      industry &&
      companySize &&
      role &&
      primaryGoal &&
      (businessType !== "agency" || agencyClientCount)
    )

  async function handleSubmit(
    event: FormEvent
  ) {
    event.preventDefault()

    if (!user?.id) return

    if (step === 1) {
      if (canContinue) {
        setErrorMessage("")
        setStep(2)
      }
      return
    }

    if (!canCreateOrganization) return

    try {
      setLoading(true)
      setErrorMessage("")

      await user.update({
        firstName: resolvedFirstName,
        lastName: resolvedLastName,
      })

      const organizationPayload: OrganizationCreatePayload = {
        name: organizationName.trim(),
        plan: businessType === "agency" ? "agency" : "professional",
        first_name: resolvedFirstName,
        last_name: resolvedLastName,
        business_type: businessType,
        country,
        industry,
        company_size: companySize,
        agency_client_count:
          businessType === "agency" ? agencyClientCount : null,
        role,
        primary_goal: primaryGoal,
      }

      await createOrganization(
        organizationPayload,
        user.id,
        user.primaryEmailAddress?.emailAddress ??
          user.emailAddresses?.[0]?.emailAddress
      )

      setActiveWorkspaceId(user.id, user.id)
      setExistingWorkspaceFound(true)
      router.replace(getWorkspaceReturnTo(new URLSearchParams(window.location.search).get("redirect_url"), window.location.origin))
    } catch (error) {
      console.error(error)
      setErrorMessage(
        getOnboardingErrorMessage(
          error,
          "Organization could not be created."
        )
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isLoaded) return
    if (!isSignedIn || !user?.id) {
      router.replace(getSignInUrl(getSafeReturnTo(new URLSearchParams(window.location.search).get("redirect_url"), window.location.origin) ?? "/onboarding"))
      return
    }

    const userId =
      user.id
    let cancelled = false

    async function checkOrganization() {
      try {
        setCheckingOrganization(true)
        setWorkspaceCheckFailed(false)
        setErrorMessage("")
        const workspaces = await getOrganizationWorkspaces(userId, userEmail)
        if (cancelled) return
        const workspace = chooseAuthWorkspace(workspaces, userId, getActiveWorkspaceId(userId))

        if (workspace) {
          setActiveWorkspaceId(userId, workspace.owner_user_id)
          setExistingWorkspaceFound(true)
          router.replace(getWorkspaceReturnTo(new URLSearchParams(window.location.search).get("redirect_url"), window.location.origin))
        }
      } catch (error) {
        if (cancelled) return
        setWorkspaceCheckFailed(true)
        setErrorMessage(
          getOnboardingErrorMessage(
            error,
            "Unable to check workspace setup. Please try again."
          )
        )
      } finally {
        if (!cancelled) setCheckingOrganization(false)
      }
    }

    void checkOrganization()
    return () => { cancelled = true }
  }, [isLoaded, isSignedIn, router, user?.id, userEmail, checkAttempt])

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <header className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
        <Link href="/" className="inline-flex items-center gap-2 text-lg font-semibold text-gray-950">
          <Image src="/icons/decisionate-logo.png" alt="" width={32} height={32} priority />Decisionate
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => void signOut({ redirectUrl: getSignInUrl(getSafeReturnTo(new URLSearchParams(window.location.search).get("redirect_url"), window.location.origin)) })}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
          >
            <LogOut size={16} aria-hidden="true" />
            {t("Switch account")}
          </button>
        </div>
      </header>

      <div className="mx-auto mt-10 w-full max-w-2xl">
        <section>
          <h1 className="text-2xl font-semibold text-gray-950">
            {t("Create your workspace")}
          </h1>

          <p className="mt-2 text-sm text-gray-600">
            {t("Tell us about your company or agency.")}
          </p>

          {checkingOrganization || existingWorkspaceFound ? (
            <p
              role="status"
              aria-live="polite"
              className="mt-8 flex items-center gap-2 text-sm text-gray-600"
            >
              <LoaderCircle size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
              {existingWorkspaceFound
                ? t("Opening your workspace...")
                : t("Checking existing workspace...")}
            </p>
          ) : workspaceCheckFailed ? (
            <div role="alert" className="mt-8 space-y-4">
              <p className="text-sm text-red-600">{errorMessage}</p>
              <button type="button" onClick={() => setCheckAttempt(value => value + 1)} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900">
                <RefreshCw size={16} aria-hidden="true" />{t("Try again")}
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-8 space-y-6">
              <p className="text-xs font-semibold text-gray-500">
                {t("Step")} {step} {t("of")} 2
              </p>

              {step === 1 ? (
                <>
                  <fieldset className="space-y-4">
                    <legend className="text-sm font-semibold text-gray-900">
                      {t("Your details")}
                    </legend>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="text-sm font-medium text-gray-700">
                        {t("First name")}
                        <input
                          type="text"
                          value={firstName ?? user?.firstName ?? ""}
                          onChange={(event) => setFirstName(event.target.value)}
                          className="mt-2 w-full rounded-lg border p-3 font-normal text-gray-900"
                          autoComplete="given-name"
                          required
                        />
                      </label>
                      <label className="text-sm font-medium text-gray-700">
                        {t("Last name")}
                        <input
                          type="text"
                          value={lastName ?? user?.lastName ?? ""}
                          onChange={(event) => setLastName(event.target.value)}
                          className="mt-2 w-full rounded-lg border p-3 font-normal text-gray-900"
                          autoComplete="family-name"
                          required
                        />
                      </label>
                    </div>
                    <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                      {t("Work email:")} <span className="font-medium text-gray-900">{userEmail || t("Not available")}</span>
                    </p>
                  </fieldset>

                  <fieldset className="space-y-4">
                    <legend className="text-sm font-semibold text-gray-900">
                      {t("Create your workspace")}
                    </legend>
                    <label className="block text-sm font-medium text-gray-700">
                      {t("Company or agency name")}
                      <input
                        type="text"
                        value={organizationName}
                        onChange={(event) => {
                          setOrganizationName(event.target.value)
                          setErrorMessage("")
                        }}
                        placeholder={t("Acme Inc")}
                        className="mt-2 w-full rounded-lg border p-3 font-normal text-gray-900"
                        autoComplete="organization"
                        required
                      />
                    </label>

                    <div>
                      <p className="text-sm font-medium text-gray-700">{t("Workspace type")}</p>
                      <div className="mt-2 grid gap-3 sm:grid-cols-2">
                        {workspaceTypes.map((type) => {
                          const selected = businessType === type.value
                          return (
                            <label
                              key={type.value}
                              className={`cursor-pointer rounded-lg border p-4 transition ${
                                selected
                                  ? "border-[var(--decisionate-brand-primary)] bg-blue-50 ring-2 ring-blue-100"
                                  : "border-gray-200 bg-white hover:border-gray-300"
                              }`}
                            >
                              <input
                                type="radio"
                                name="business-type"
                                value={type.value}
                                checked={selected}
                                onChange={() => setBusinessType(type.value)}
                                className="mr-2 h-4 w-4 accent-[var(--decisionate-brand-primary)]"
                              />
                              <span>
                                <span className="font-semibold text-gray-900">{t(type.name)}</span>
                              </span>
                              <span className="mt-2 block text-sm text-gray-600">{t(type.description)}</span>
                            </label>
                          )
                        })}
                      </div>
                    </div>

                    <label className="block text-sm font-medium text-gray-700">
                      {t("Country")}
                      <select
                        aria-label={t("Country")}
                        value={country}
                        onChange={(event) => setCountry(event.target.value)}
                        className="mt-2 w-full rounded-lg border bg-white p-3 font-normal text-gray-900"
                        required
                      >
                        <option value="">{t("Select a country")}</option>
                        {countryOptions.map((option) => <option key={option} value={option}>{t(option)}</option>)}
                      </select>
                    </label>
                  </fieldset>

                  {errorMessage && <p role="alert" className="text-sm font-medium text-red-600">{errorMessage}</p>}

                  <button
                    type="submit"
                    disabled={!canContinue}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--decisionate-brand-primary)] px-6 py-3 text-sm font-medium text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 sm:w-auto"
                  >
                    {t("Continue")}
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                </>
              ) : (
                <>
                  <fieldset className="space-y-4">
                    <legend className="text-sm font-semibold text-gray-900">
                      {t("Personalize Decisionate")}
                    </legend>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="text-sm font-medium text-gray-700">
                        {t("Industry")}
                        <select aria-label={t("Industry")} value={industry} onChange={(event) => setIndustry(event.target.value)} className="mt-2 w-full rounded-lg border bg-white p-3 font-normal text-gray-900" required>
                          <option value="">{t("Select an industry")}</option>
                          {industryOptions.map((option) => <option key={option} value={option}>{t(option)}</option>)}
                        </select>
                      </label>
                      <label className="text-sm font-medium text-gray-700">
                        {t("Company size")}
                        <select aria-label={t("Company size")} value={companySize} onChange={(event) => setCompanySize(event.target.value)} className="mt-2 w-full rounded-lg border bg-white p-3 font-normal text-gray-900" required>
                          <option value="">{t("Select company size")}</option>
                          {companySizeOptions.map((option) => <option key={option} value={option}>{option} {t("people")}</option>)}
                        </select>
                      </label>
                      {businessType === "agency" && (
                        <label className="text-sm font-medium text-gray-700">
                          {t("Clients currently managed")}
                          <select aria-label={t("Clients currently managed")} value={agencyClientCount} onChange={(event) => setAgencyClientCount(event.target.value)} className="mt-2 w-full rounded-lg border bg-white p-3 font-normal text-gray-900" required>
                            <option value="">{t("Select client count")}</option>
                            {agencyClientCountOptions.map((option) => <option key={option} value={option}>{option} {t("clients")}</option>)}
                          </select>
                        </label>
                      )}
                      <label className="text-sm font-medium text-gray-700">
                        {t("Role or job function")}
                        <select aria-label={t("Role or job function")} value={role} onChange={(event) => setRole(event.target.value)} className="mt-2 w-full rounded-lg border bg-white p-3 font-normal text-gray-900" required>
                          <option value="">{t("Select your role")}</option>
                          {roleOptions.map((option) => <option key={option} value={option}>{t(option)}</option>)}
                        </select>
                      </label>
                    </div>
                    <label className="block text-sm font-medium text-gray-700">
                      {t("Primary goal with Decisionate")}
                      <select aria-label={t("Primary goal with Decisionate")} value={primaryGoal} onChange={(event) => setPrimaryGoal(event.target.value)} className="mt-2 w-full rounded-lg border bg-white p-3 font-normal text-gray-900" required>
                        <option value="">{t("Select your primary goal")}</option>
                        {primaryGoalOptions.map((option) => <option key={option} value={option}>{t(option)}</option>)}
                      </select>
                    </label>
                  </fieldset>

                  {errorMessage && <p role="alert" className="text-sm font-medium text-red-600">{errorMessage}</p>}

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      disabled={loading}
                      className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-6 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
                    >
                      <ArrowLeft size={16} aria-hidden="true" />
                      {t("Back")}
                    </button>
                    <button
                      type="submit"
                      disabled={!canCreateOrganization || loading}
                      className="inline-flex items-center gap-2 rounded-lg bg-[var(--decisionate-brand-primary)] px-6 py-3 text-sm font-medium text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500"
                    >
                      {loading ? t("Creating workspace...") : t("Create workspace")}
                      {loading && <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                    </button>
                  </div>
                </>
              )}
            </form>
          )}
        </section>

      </div>
    </main>
  )
}
