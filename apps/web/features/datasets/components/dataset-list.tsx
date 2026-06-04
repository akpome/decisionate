"use client"

import { getDatasets, deleteDataset } from "@/lib/api"
import Link from "next/link"
import { useUser } from "@clerk/nextjs"

interface DatasetListProps {
  datasets: Dataset[]
  onRefresh: () => Promise<void>
}

interface Dataset {
    id: number
    file_name: string
    row_count: number
    column_count: number
    created_at?: string
}

export function DatasetList({
    datasets,
    onRefresh,
}: DatasetListProps) {

    const { user } = useUser()

    async function handleDelete(
        datasetId: number
    ) {
        const confirmed =
            window.confirm(
                "Delete this dataset?"
            )

        if (!confirmed) return

        try {
            await deleteDataset(
                datasetId,
                user?.id ?? ""
            )

            await onRefresh()

        } catch (error) {
            console.error(
                "Failed to delete dataset",
                error
            )
        }
    }

    if (!datasets.length) {
        return (
            <div className="rounded-xl border bg-white p-4 text-gray-500">
                No datasets uploaded yet.
            </div>
        )
    }

    return (
        <div className="space-y-4">
            {datasets.map((dataset) => (
                <div
                    key={dataset.id}
                    className="flex items-center justify-between rounded-xl border bg-white p-4"
                >
                    <Link
                        href={`/dashboard/datasets/${dataset.id}`}
                        className="flex-1"
                    >
                        <div className="font-medium">
                            {dataset.file_name}
                        </div>

                        <div className="mt-2 text-sm text-gray-500">
                            {dataset.row_count} rows •{" "}
                            {dataset.column_count} columns
                        </div>
                    </Link>

                    <button
                        onClick={() =>
                            handleDelete(
                                dataset.id
                            )
                        }
                        className="ml-4 rounded-lg border px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                    >
                        Delete
                    </button>
                </div>
            ))}
        </div>
    )
}