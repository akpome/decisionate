import {
  ApiError,
  getDatasetDetails,
  updateDatasetMetricSelection,
  type DatasetMetricSelectionResponse,
} from "@/lib/api"

type SaveOptions = {
  datasetId: number
  userId: string
  workspaceId?: string
  columns: string[]
  objective: string
  restoreRecommended?: boolean
  recommendedColumns: string[]
  policyVersion?: string
}

type SaveResult =
  | {
    saved: true
    selection: DatasetMetricSelectionResponse
    dataset?: Awaited<ReturnType<typeof getDatasetDetails>>
  }
  | { saved: false; message: string; retryable: boolean }

function isRejectedRequest(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408
}

export async function refreshDatasetMetrics(datasetId: number, userId: string, workspaceId?: string) {
  const load = () => getDatasetDetails(datasetId, userId, workspaceId, {
    includeAIAnalysis: false,
    forceRefresh: true,
    notifyAvailability: false,
  })
  try {
    return await load()
  } catch (error) {
    if (isRejectedRequest(error)) throw error
    await new Promise(resolve => setTimeout(resolve, 350))
    return load()
  }
}

export async function saveMetricSelectionWithRecovery(options: SaveOptions): Promise<SaveResult> {
  const { datasetId, userId, workspaceId, columns, objective, restoreRecommended, policyVersion } = options
  try {
    const selection = await updateDatasetMetricSelection(
      datasetId, columns, userId, workspaceId, objective, restoreRecommended, policyVersion,
    )
    return { saved: true, selection }
  } catch (error) {
    if (isRejectedRequest(error)) {
      const status = error.status
      const messages: Record<number, string> = {
        401: "Please sign in again to save your metrics. Your selections are still here.",
        402: "Your workspace subscription needs attention before these changes can be saved.",
        403: "You no longer have permission to change this dataset's metrics.",
        404: "This dataset is no longer available.",
        429: "Please wait a moment before saving again. Your selections are still here.",
      }
      const message = messages[status] ?? "These metric choices could not be saved. Refresh the dataset to check the available metrics."
      return { saved: false, message, retryable: status === 429 }
    }
    // Verify a potentially committed write without replaying the mutation.
    try {
      const dataset = await refreshDatasetMetrics(datasetId, userId, workspaceId)
      const expected = new Set(restoreRecommended ? options.recommendedColumns : columns)
      const actual = dataset.selected_metric_columns
      if (
        dataset.metric_selection_configured === true &&
        Array.isArray(actual) &&
        new Set(actual).size === expected.size && actual.every((column: string) => expected.has(column)) &&
        dataset.metric_profile?.objective === objective &&
        (!policyVersion || dataset.metric_profile?.curated_recommendations?.policyVersion === policyVersion)
      ) {
        return {
          saved: true,
          selection: {
            dataset_id: datasetId,
            file_name: dataset.file_name,
            numeric_columns: dataset.numeric_columns ?? [],
            selected_metric_columns: actual,
            metric_profile: dataset.metric_profile,
          },
          dataset,
        }
      }
    } catch {
      // Keep the customer's draft when the saved state cannot be verified.
    }
    return {
      saved: false,
      message: "We couldn't confirm your changes were saved. Your selections are still here. Please try again.",
      retryable: true,
    }
  }
}
