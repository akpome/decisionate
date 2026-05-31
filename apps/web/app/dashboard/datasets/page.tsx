import { CsvUpload } from "@/features/datasets/components/csv-upload"

export default function DatasetsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">
          Datasets
        </h1>

        <p className="mt-2 text-gray-500">
          Upload and manage your business data.
        </p>
      </div>

      <div className="rounded-2xl border bg-white p-8 shadow-sm">
        <h2 className="mb-4 text-xl font-semibold">
          Upload CSV
        </h2>

        <p className="mb-6 text-sm text-gray-500">
          Upload a CSV file to begin generating insights and dashboards.
        </p>

        <CsvUpload />
      </div>
    </div>
  )
}