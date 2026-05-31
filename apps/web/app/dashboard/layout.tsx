import Link from "next/link"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r bg-white">
        {/* Brand */}
        <div className="border-b p-6">
          <h1 className="text-2xl font-bold">
            Decisionate
          </h1>

          <p className="mt-1 text-sm text-gray-500">
            Decisions from data
          </p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4">
          <div className="space-y-1">
            <Link
              href="/dashboard"
              className="block rounded-xl px-4 py-3 hover:bg-gray-100"
            >
              Dashboard
            </Link>

            <Link
              href="/dashboard/insights"
              className="block rounded-xl px-4 py-3 hover:bg-gray-100"
            >
              Insights
            </Link>

            <Link
              href="/dashboard/datasets"
              className="block rounded-xl px-4 py-3 hover:bg-gray-100"
            >
              Datasets
            </Link>

            <Link
              href="/dashboard/reports"
              className="block rounded-xl px-4 py-3 hover:bg-gray-100"
            >
              Reports
            </Link>

            <Link
              href="/dashboard/settings"
              className="block rounded-xl px-4 py-3 hover:bg-gray-100"
            >
              Settings
            </Link>
          </div>
        </nav>

        {/* User */}
        <div className="border-t p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">
              Account
            </span>

          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto p-8">
        {children}
      </main>
    </div>
  )
}