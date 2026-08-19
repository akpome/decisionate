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

const signupPlans = [
  {
    value: "professional",
    name: "Professional",
    description: "For one business workspace.",
    detail: "5,000 Decisionate AI credits/month",
  },
  {
    value: "agency",
    name: "Agency",
    description: "For an agency managing clients.",
    detail: "Up to 10 client workspaces · 25,000 credits/month",
  },
] as const

type SignupPlan = (typeof signupPlans)[number]["value"]

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
  const [selectedPlan, setSelectedPlan] =
    useState<SignupPlan>("professional")

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

  const canCreateOrganization =
    Boolean(organizationName.trim()) &&
    !loading &&
    !checkingOrganization

  async function handleSubmit(
    event: FormEvent
  ) {
    event.preventDefault()

    if (!user?.id || !canCreateOrganization) return

    try {
      setLoading(true)
      setErrorMessage("")

      const organizationPayload: OrganizationCreatePayload = {
        name: organizationName.trim(),
        plan: selectedPlan,
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
            <form
              onSubmit={handleSubmit}
              className="mt-8 space-y-4"
            >
            <fieldset>
              <legend className="text-sm font-medium">
                Choose your 30-day free trial
              </legend>

              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {signupPlans.map((plan) => {
                  const selected = selectedPlan === plan.value

                  return (
                    <label
                      key={plan.value}
                      className={`cursor-pointer rounded-xl border p-4 transition ${
                        selected
                          ? "border-[var(--decisionate-brand-primary)] bg-blue-50 ring-2 ring-blue-100"
                          : "border-gray-200 bg-white hover:border-gray-300"
                      }`}
                    >
                      <input
                        type="radio"
                        name="signup-plan"
                        value={plan.value}
                        checked={selected}
                        onChange={() => setSelectedPlan(plan.value)}
                        className="sr-only"
                      />
                      <span className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-gray-900">
                          {plan.name}
                        </span>
                        <span
                          aria-hidden="true"
                          className={`h-4 w-4 rounded-full border-4 ${
                            selected
                              ? "border-[var(--decisionate-brand-primary)]"
                              : "border-gray-300"
                          }`}
                        />
                      </span>
                      <span className="mt-2 block text-sm text-gray-600">
                        {plan.description}
                      </span>
                      <span className="mt-2 block text-xs font-medium text-gray-500">
                        {plan.detail}
                      </span>
                    </label>
                  )
                })}
              </div>

              <p className="mt-2 text-xs text-gray-500">
                No payment is required during setup. You can manage billing after your trial begins.
              </p>
            </fieldset>

            <div>
              <label
                htmlFor="organization-name"
                className="mb-2 block text-sm font-medium"
              >
                Workspace name
              </label>

              <input
                id="organization-name"
                type="text"
                value={
                  organizationName
                }
                onChange={(event) => {
                  setOrganizationName(
                    event.target.value
                  )
                  setErrorMessage("")
                }}
                placeholder="Acme Inc"
                className="w-full rounded-xl border p-3"
                required
              />
            </div>

            {errorMessage && (
              <p
                role="alert"
                className="text-sm font-medium text-red-600"
              >
                {errorMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={!canCreateOrganization}
              className="w-full rounded-xl bg-[var(--decisionate-brand-primary)] px-6 py-3 text-sm font-medium text-[var(--decisionate-brand-primary-surface-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 sm:w-auto"
            >
              {loading
                ? "Creating..."
                : "Continue"}
            </button>
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
