import type { PublicDemoDashboardResponse } from "@/lib/api"
import { ApiReadCache } from "@/lib/api-read-cache"
import {
  defaultDashboardKey,
  isDashboardKey
} from "@/features/dashboards/dashboard-definitions"
import catalog from "../data/catalog.json"

const demoCache = new ApiReadCache(catalog.length)
const demoCacheTtlMs = 24 * 60 * 60 * 1000

function waitForSample(
  request: Promise<PublicDemoDashboardResponse>,
  signal?: AbortSignal
) {
  if (!signal) return request
  signal.throwIfAborted()

  // Cancelling a view must not cancel a shared preload or another demo view.
  return new Promise<PublicDemoDashboardResponse>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener("abort", onAbort, { once: true })
    request.then(
      (data) => {
        signal.removeEventListener("abort", onAbort)
        resolve(data)
      },
      (error) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      }
    )
  })
}

export async function loadPublicDemoDashboard(
  datasetKey: string,
  dashboard?: string,
  signal?: AbortSignal
): Promise<PublicDemoDashboardResponse | null> {
  signal?.throwIfAborted()
  const key = datasetKey.trim().toLowerCase()
  const asset = catalog.find((entry) => entry.key === key)?.asset
  const selectedDashboard = dashboard?.trim() || defaultDashboardKey
  if (!asset || !isDashboardKey(selectedDashboard)) return null

  const request = demoCache.get(
    asset,
    async () => {
      const response = await fetch(asset, {
        cache: "force-cache",
        credentials: "omit",
        signal: AbortSignal.timeout(10000)
      })
      if (!response.ok) {
        throw new Error("Sample data is unavailable. Please try again.")
      }
      const data = (await response.json()) as PublicDemoDashboardResponse
      if (
        !data ||
        data.demo !== true ||
        data.selected_dataset !== key ||
        !Array.isArray(data.dataset?.chart?.data) ||
        data.capabilities?.can_create_decisions !== false ||
        data.capabilities?.can_upload !== false ||
        data.capabilities?.can_delete_datasets !== false
      ) {
        throw new Error("The sample dataset could not be loaded. Please try again.")
      }
      return data
    },
    demoCacheTtlMs
  )

  const data = await waitForSample(request, signal)
  return { ...data, selected_dashboard: selectedDashboard }
}

export function prefetchPublicDemo() {
  void loadPublicDemoDashboard("google-analytics").catch(() => {
    // A failed optional preload must not prevent navigation or a later retry.
  })
}
