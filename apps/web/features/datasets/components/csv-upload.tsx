"use client"

import { useState } from "react"
import Papa from "papaparse"
import { uploadDataset } from "@/lib/api"
import { useUser } from "@clerk/nextjs"

interface CsvUploadProps {
  onUploadSuccess: () => void
}

export function CsvUpload({
  onUploadSuccess,
}: CsvUploadProps) {
  const { user } = useUser()

  const [fileName, setFileName] = useState("")
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<any[]>([])

  function handleFileUpload(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0]

    if (!file) return

    setFileName(file.name)
    setLoading(true)

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,

      complete: async (results) => {
        const parsedData = results.data as any[]
        setData(parsedData)

        await uploadDataset(
          file,
          user?.id ?? ""
        )

        console.log(
          "UPLOAD SUCCESS CALLBACK"
        )

        await onUploadSuccess()

        console.log(
          "DATASETS RELOADED"
        )

        setLoading(false)
      },

      error: () => {
        setLoading(false)
      },
    })
  }

  return (
    <div className="space-y-6">
      {/* Upload Area */}
      <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center transition hover:bg-gray-100">
        <div className="space-y-2">
          <p className="text-lg font-medium">
            Upload CSV File
          </p>

          <p className="text-sm text-gray-500">
            Drag and drop or click to browse
          </p>
        </div>

        <input
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleFileUpload}
        />
      </label>

      {/* Upload State */}
      {loading && (
        <div className="rounded-xl border bg-gray-50 p-4 text-sm text-gray-600">
          Parsing CSV...
        </div>
      )}

      {/* File Info */}
      {fileName && !loading && (
        <div className="rounded-xl border bg-white p-4">
          <p className="font-medium">
            Uploaded File
          </p>

          <p className="mt-1 text-sm text-gray-500">
            {fileName}
          </p>

          <p className="mt-2 text-sm text-gray-500">
            {data.length} rows detected
          </p>
        </div>
      )}

      {/* Data Preview */}
      {data.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-gray-50">
              <tr>
                {Object.keys(data[0]).map((key) => (
                  <th
                    key={key}
                    className="border-b px-4 py-3 text-left font-medium text-gray-600"
                  >
                    {key}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {data.slice(0, 5).map((row, index) => (
                <tr key={index}>
                  {Object.values(row).map((value, i) => (
                    <td
                      key={i}
                      className="border-b px-4 py-3 text-gray-700"
                    >
                      {String(value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}