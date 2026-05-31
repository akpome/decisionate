import { currentUser } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"

export default async function SettingsPage() {
  const user = await currentUser()

  if (!user) {
    redirect("/sign-in")
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">
          Settings
        </h1>

        <p className="mt-2 text-gray-500">
          Manage your account and workspace preferences.
        </p>
      </div>

      {/* Profile Section */}
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
              value={`${user.firstName ?? ""} ${user.lastName ?? ""}`}
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
              value={
                user.emailAddresses[0]?.emailAddress ?? ""
              }
              readOnly
              className="w-full rounded-xl border bg-gray-50 p-3 text-gray-700"
            />
          </div>
        </div>
      </div>

      {/* Organization Section */}
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="mb-6 text-xl font-semibold">
          Organization
        </h2>

        <div className="space-y-5">
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-600">
              Organization Name
            </label>

            <input
              type="text"
              placeholder="Decisionate Workspace"
              className="w-full rounded-xl border p-3"
            />
          </div>

          <button className="rounded-xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:opacity-90">
            Save Changes
          </button>
        </div>
      </div>

      {/* Danger Zone */}
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
    </div>
  )
}