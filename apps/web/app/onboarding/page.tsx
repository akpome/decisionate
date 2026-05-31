import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"

export default async function OnboardingPage() {
  const { userId } = await auth()

  if (!userId) {
    redirect("/sign-in")
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-xl rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="mb-2 text-3xl font-bold">
          Welcome to Decisionate
        </h1>

        <p className="mb-8 text-gray-600">
          Let's create your organization.
        </p>

        <form className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium">
              Organization Name
            </label>

            <input
              type="text"
              placeholder="Acme Inc"
              className="w-full rounded-xl border p-3"
            />
          </div>

          <button
            className="rounded-xl bg-black px-6 py-3 text-white"
          >
            Continue
          </button>
        </form>
      </div>
    </main>
  )
}