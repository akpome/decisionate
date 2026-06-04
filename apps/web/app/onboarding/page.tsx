"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { getMyOrganization } from "@/lib/api"

import { useUser } from "@clerk/nextjs"

import { createOrganization } from "@/lib/api"

export default function OnboardingPage() {
  const { user } = useUser()

  const router = useRouter()

  const [organizationName, setOrganizationName] =
    useState("")

  const [loading, setLoading] =
    useState(false)



  async function handleSubmit(
    event: React.FormEvent
  ) {
    event.preventDefault()

    if (!user?.id) return

    try {
      setLoading(true)

      await createOrganization(
        organizationName,
        user.id
      )

      router.push(
        "/dashboard"
      )
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }


  useEffect(() => {
    if (!user?.id) return

    async function checkOrganization() {
      try {
        const organization =
          await getMyOrganization(
            user?.id ?? ""
          )

        if (organization) {
          router.push(
            "/dashboard"
          )
        }
      } catch (error) {
        console.error(error)
      }
    }

    checkOrganization()
  }, [user?.id, router])


  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-xl rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="mb-2 text-3xl font-bold">
          Welcome to Decisionate
        </h1>

        <p className="mb-8 text-gray-600">
          Let's create your organization.
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

          <button
            type="submit"
            disabled={loading}
            className="rounded-xl bg-black px-6 py-3 text-white"
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