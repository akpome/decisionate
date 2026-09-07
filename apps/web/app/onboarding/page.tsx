"use client"

import {
  useEffect,
  useState,
  type FormEvent,
} from "react"
import { useRouter } from "next/navigation"
import { useClerk, useUser } from "@clerk/nextjs"
import { LogOut } from "lucide-react"

import {
  createOrganization,
  getMyOrganization,
  getOrganizationWorkspaces,
  type OrganizationCreatePayload,
} from "@/lib/api"
import {
  ThemeToggle,
} from "@/app/theme-toggle"

const onboardingUseCases = [
  "Direct company workspace",
  "Agency client portfolio",
  "Shared client reporting portal",
]

const workspaceTypes = [
  {
    value: "business",
    name: "Business",
    description: "For your own business workspace.",
    detail: "Professional trial · 5,000 Decisionate AI credits/month",
  },
  {
    value: "agency",
    name: "Agency",
    description: "For an agency managing client workspaces.",
    detail: "Agency trial · Up to 10 client workspaces · 25,000 credits/month",
  },
] as const

type BusinessType = (typeof workspaceTypes)[number]["value"]

const countryOptions = [
  "Canada",
  "United States",
  "United Kingdom",
  "Australia",
  "Nigeria",
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
  const { user } = useUser()
  const { signOut } = useClerk()
  const userEmail =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress

  const router = useRouter()

  const [organizationName, setOrganizationName] =
    useState("")
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
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

  const resolvedFirstName = firstName.trim() || user?.firstName || ""
  const resolvedLastName = lastName.trim() || user?.lastName || ""
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
    !checkingOrganization
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

      router.push(
        "/dashboard"
      )
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
    if (!user?.id) return

    const userId =
      user.id

    async function checkOrganization() {
      try {
        setCheckingOrganization(true)
        const [organization, workspaces] =
          await Promise.all([
            getMyOrganization(
              userId
            ),
            getOrganizationWorkspaces(
              userId,
              userEmail
            ),
          ])

        if (organization || workspaces.length > 0) {
          setExistingWorkspaceFound(true)
          router.push(
            "/dashboard"
          )
        }
      } catch (error) {
        console.error(error)
        setErrorMessage(
          getOnboardingErrorMessage(
            error,
            "Unable to check organization setup."
          )
        )
      } finally {
        setCheckingOrganization(false)
      }
    }

    void checkOrganization()
  }, [router, user?.id, userEmail])

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="mx-auto flex max-w-5xl justify-end gap-2">
        <ThemeToggle />
        <button
          type="button"
          onClick={() => void signOut({ redirectUrl: "/sign-in" })}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
        >
          <LogOut size={16} aria-hidden="true" />
          Switch account
        </button>
      </div>

      <div className="mx-auto mt-6 grid w-full max-w-5xl gap-5 lg:min-h-[calc(100vh-6.5rem)] lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-center">
        <section className="rounded-2xl bg-white p-6 shadow-sm sm:p-8">
          <p className="text-sm font-semibold uppercase tracking-wide text-[var(--decisionate-brand-primary-text)]">
            Workspace setup
          </p>

          <h1 className="mt-2 text-2xl font-bold sm:text-3xl">
            Welcome to Decisionate
          </h1>

          <p className="mt-3 max-w-2xl text-gray-600">
            Create the workspace that will hold your datasets, dashboards, reports, alerts, and decisions. You can use it for your own business or for agency-managed client work.
          </p>

          {checkingOrganization || existingWorkspaceFound ? (
            <p
              role="status"
              aria-live="polite"
              className="mt-8 rounded-xl border bg-gray-50 px-4 py-3 text-sm text-gray-600"
            >
              {existingWorkspaceFound
                ? "Opening your workspace..."
                : "Checking existing workspace..."}
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="mt-8 space-y-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Step {step} of 2
              </p>

              {step === 1 ? (
                <>
                  <fieldset className="space-y-4">
                    <legend className="text-sm font-semibold text-gray-900">
                      Your details
                    </legend>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="text-sm font-medium text-gray-700">
                        First name
                        <input
                          type="text"
                          value={firstName || user?.firstName || ""}
                          onChange={(event) => setFirstName(event.target.value)}
                          className="mt-2 w-full rounded-xl border p-3 font-normal text-gray-900"
                          autoComplete="given-name"
                          required
                        />
                      </label>
                      <label className="text-sm font-medium text-gray-700">
                        Last name
                        <input
                          type="text"
                          value={lastName || user?.lastName || ""}
                          onChange={(event) => setLastName(event.target.value)}
                          className="mt-2 w-full rounded-xl border p-3 font-normal text-gray-900"
                          autoComplete="family-name"
                          required
                        />
                      </label>
                    </div>
                    <p className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                      Work email: <span className="font-medium text-gray-900">{userEmail || "Not available"}</span>
                    </p>
                  </fieldset>

                  <fieldset className="space-y-4">
                    <legend className="text-sm font-semibold text-gray-900">
                      Create your workspace
                    </legend>
                    <label className="block text-sm font-medium text-gray-700">
                      Company or agency name
                      <input
                        type="text"
                        value={organizationName}
                        onChange={(event) => {
                          setOrganizationName(event.target.value)
                          setErrorMessage("")
                        }}
                        placeholder="Acme Inc"
                        className="mt-2 w-full rounded-xl border p-3 font-normal text-gray-900"
                        autoComplete="organization"
                        required
                      />
                    </label>

                    <div>
                      <p className="text-sm font-medium text-gray-700">Workspace type</p>
                      <div className="mt-2 grid gap-3 sm:grid-cols-2">
                        {workspaceTypes.map((type) => {
                          const selected = businessType === type.value
                          return (
                            <label
                              key={type.value}
                              className={`cursor-pointer rounded-xl border p-4 transition ${
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
                                className="sr-only"
                              />
                              <span className="flex items-center justify-between gap-3">
                                <span className="font-semibold text-gray-900">{type.name}</span>
                                <span
                                  aria-hidden="true"
                                  className={`h-4 w-4 rounded-full border-4 ${
                                    selected
                                      ? "border-[var(--decisionate-brand-primary)]"
                                      : "border-gray-300"
                                  }`}
                                />
                              </span>
                              <span className="mt-2 block text-sm text-gray-600">{type.description}</span>
                              <span className="mt-2 block text-xs font-medium text-gray-500">{type.detail}</span>
                            </label>
                          )
                        })}
                      </div>
                    </div>

                    <label className="block text-sm font-medium text-gray-700">
                      Country
                      <select
                        value={country}
                        onChange={(event) => setCountry(event.target.value)}
                        className="mt-2 w-full rounded-xl border bg-white p-3 font-normal text-gray-900"
                        required
                      >
                        <option value="">Select a country</option>
                        {countryOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </label>
                  </fieldset>

                  {errorMessage && <p role="alert" className="text-sm font-medium text-red-600">{errorMessage}</p>}

                  <button
                    type="submit"
                    disabled={!canContinue}
                    className="w-full rounded-xl bg-[var(--decisionate-brand-primary)] px-6 py-3 text-sm font-medium text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 sm:w-auto"
                  >
                    Continue
                  </button>
                </>
              ) : (
                <>
                  <fieldset className="space-y-4">
                    <legend className="text-sm font-semibold text-gray-900">
                      Personalize Decisionate
                    </legend>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="text-sm font-medium text-gray-700">
                        Industry
                        <select value={industry} onChange={(event) => setIndustry(event.target.value)} className="mt-2 w-full rounded-xl border bg-white p-3 font-normal text-gray-900" required>
                          <option value="">Select an industry</option>
                          {industryOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                      </label>
                      <label className="text-sm font-medium text-gray-700">
                        Company size
                        <select value={companySize} onChange={(event) => setCompanySize(event.target.value)} className="mt-2 w-full rounded-xl border bg-white p-3 font-normal text-gray-900" required>
                          <option value="">Select company size</option>
                          {companySizeOptions.map((option) => <option key={option} value={option}>{option} people</option>)}
                        </select>
                      </label>
                      {businessType === "agency" && (
                        <label className="text-sm font-medium text-gray-700">
                          Clients currently managed
                          <select value={agencyClientCount} onChange={(event) => setAgencyClientCount(event.target.value)} className="mt-2 w-full rounded-xl border bg-white p-3 font-normal text-gray-900" required>
                            <option value="">Select client count</option>
                            {agencyClientCountOptions.map((option) => <option key={option} value={option}>{option} clients</option>)}
                          </select>
                        </label>
                      )}
                      <label className="text-sm font-medium text-gray-700">
                        Role or job function
                        <select value={role} onChange={(event) => setRole(event.target.value)} className="mt-2 w-full rounded-xl border bg-white p-3 font-normal text-gray-900" required>
                          <option value="">Select your role</option>
                          {roleOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                      </label>
                    </div>
                    <label className="block text-sm font-medium text-gray-700">
                      Primary goal with Decisionate
                      <select value={primaryGoal} onChange={(event) => setPrimaryGoal(event.target.value)} className="mt-2 w-full rounded-xl border bg-white p-3 font-normal text-gray-900" required>
                        <option value="">Select your primary goal</option>
                        {primaryGoalOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </label>
                  </fieldset>

                  <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
                    Your {businessType === "agency" ? "Agency" : "Professional"} trial includes full plan access for one month. No credit card is required.
                  </p>

                  {errorMessage && <p role="alert" className="text-sm font-medium text-red-600">{errorMessage}</p>}

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="rounded-xl border border-gray-300 bg-white px-6 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={!canCreateOrganization || loading}
                      className="rounded-xl bg-[var(--decisionate-brand-primary)] px-6 py-3 text-sm font-medium text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500"
                    >
                      {loading ? "Creating workspace..." : "Create workspace"}
                    </button>
                  </div>
                </>
              )}
            </form>
          )}
        </section>

        <aside className="rounded-2xl border bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-lg font-semibold">
            Built for mixed customers
          </h2>

          <p className="mt-2 text-sm leading-6 text-gray-600">
            Start simple now. Later, settings lets you brand the workspace, add teammates, and share client access when needed.
          </p>

          <ul className="mt-5 space-y-3 text-sm text-gray-700">
            {onboardingUseCases.map((useCase) => (
              <li
                key={useCase}
                className="rounded-xl border bg-gray-50 px-3 py-2"
              >
                {useCase}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </main>
  )
}
