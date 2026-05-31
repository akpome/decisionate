export default function ReportsPage() {
  const reports = [
    {
      name: "Monthly Revenue Summary",
      status: "Ready",
      updatedAt: "2 hours ago",
    },
    {
      name: "Customer Growth Report",
      status: "Ready",
      updatedAt: "Yesterday",
    },
    {
      name: "Sales Performance Overview",
      status: "Generating",
      updatedAt: "Just now",
    },
  ]

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">
          Reports
        </h1>

        <p className="mt-2 text-gray-500">
          Generate and review business reports.
        </p>
      </div>

      {/* Action Bar */}
      <div className="flex items-center justify-between rounded-2xl border bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-xl font-semibold">
            Create Report
          </h2>

          <p className="mt-1 text-sm text-gray-500">
            Generate summaries and insights from your datasets.
          </p>
        </div>

        <button className="rounded-xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:opacity-90">
          New Report
        </button>
      </div>

      {/* Reports List */}
      <div className="rounded-2xl border bg-white shadow-sm">
        <div className="border-b px-6 py-4">
          <h2 className="text-lg font-semibold">
            Recent Reports
          </h2>
        </div>

        <div className="divide-y">
          {reports.map((report) => (
            <div
              key={report.name}
              className="flex items-center justify-between px-6 py-5"
            >
              <div>
                <h3 className="font-medium">
                  {report.name}
                </h3>

                <p className="mt-1 text-sm text-gray-500">
                  Updated {report.updatedAt}
                </p>
              </div>

              <div>
                <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                  {report.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}