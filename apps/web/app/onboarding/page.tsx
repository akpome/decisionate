"use client"

import {
  useEffect,
  useState,
  type FormEvent,
} from "react"
import { useRouter } from "next/navigation"
import { useUser } from "@clerk/nextjs"

import {
  createOrganization,
  getMyOrganization,
} from "@/lib/api"

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

  const router = useRouter()

  const [organizationName, setOrganizationName] =
    useState("")

  const [loading, setLoading] =
    useState(false)
  const [errorMessage, setErrorMessage] =
    useState("")

  const canCreateOrganization =
    Boolean(organizationName.trim()) &&
    !loading

  async function handleSubmit(
    event: FormEvent
  ) {
    event.preventDefault()

    if (!user?.id || !canCreateOrganization) return

    try {
      setLoading(true)
      setErrorMessage("")

      await createOrganization(
        organizationName.trim(),
        user.id
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
        const organization =
          await getMyOrganization(
            userId
          )

        if (organization) {
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
      }
    }

    void checkOrganization()
  }, [user?.id, router])

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-xl rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="mb-2 text-3xl font-bold">
          Welcome to Decisionate
        </h1>

        <p className="mb-8 text-gray-600">
          Create your organization to continue.
        </p>

        <form
          onSubmit={handleSubmit}
          className="space-y-4"
        >
          <div>
            <label className="mb-2 block text-sm font-medium">
              Organization Name
            </label>

            <input
              type="text"
              value={
                organizationName
              }
              onChange={(e) =>
                setOrganizationName(
                  e.target.value
                )
              }
              placeholder="Acme Inc"
              className="w-full rounded-xl border p-3"
              required
            />
          </div>

          {errorMessage && (
            <p className="text-sm font-medium text-red-600">
              {errorMessage}
            </p>
          )}

          <button
            type="submit"
            disabled={!canCreateOrganization}
            className="rounded-xl bg-black px-6 py-3 text-white disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {loading
              ? "Creating..."
              : "Continue"}
          </button>
        </form>
      </div>
    </main>
  )
}
