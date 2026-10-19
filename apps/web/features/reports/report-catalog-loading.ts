import type { CatalogDataset } from "@/features/relationships/types"

export type CatalogPage = { datasets: CatalogDataset[]; next_offset: number | null }
type CatalogRequest = <T>(path: string, init: RequestInit) => Promise<T>

export async function loadReportCatalogPage(request: CatalogRequest, offset: number, signal: AbortSignal,
  onPage: (page: CatalogPage) => void, onDataset: (dataset: CatalogDataset) => void) {
  const page = await request<CatalogPage>(`/catalog?metadata_only=true&offset=${offset}`, { signal })
  if (signal.aborted) return
  onPage(page)
  const pending = page.datasets.filter(dataset => dataset.catalog_status === "pending")
  let index = 0
  async function worker() {
    while (!signal.aborted && index < pending.length) {
      const dataset = pending[index++]
      try {
        const result = await request<CatalogPage>(`/catalog?dataset_id=${dataset.dataset_id}`, { signal })
        if (signal.aborted) return
        const resolved = result.datasets.find(item => item.dataset_id === dataset.dataset_id)
        onDataset(resolved || { ...dataset, catalog_status: undefined, error_code: "dataset_unavailable" })
      } catch {
        if (signal.aborted) return
        onDataset({ ...dataset, catalog_status: undefined, error_code: "dataset_unavailable" })
      }
    }
  }
  // Limit concurrent file reads and memory use; publish each source as it finishes.
  await Promise.all([worker(), worker()])
}
