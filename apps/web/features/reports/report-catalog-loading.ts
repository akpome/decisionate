import type { CatalogDataset } from "@/features/relationships/types"

export type CatalogPage = { datasets: CatalogDataset[]; next_offset: number | null }
type CatalogRequest = <T>(path: string, init: RequestInit) => Promise<T>

export function mergeReportCatalog(current: CatalogDataset[], added: CatalogDataset[]) {
  const result = new Map(current.map(dataset => [dataset.dataset_id, dataset]))
  for (const dataset of added) {
    const existing = result.get(dataset.dataset_id)
    // Metadata must not replace metrics already loaded by a saved report or earlier page.
    if (dataset.catalog_status === "pending" && existing && existing.catalog_status !== "pending") continue
    result.set(dataset.dataset_id, dataset)
  }
  return [...result.values()]
}

export async function loadReportCatalogDataset(request: CatalogRequest, dataset: CatalogDataset, signal: AbortSignal): Promise<CatalogDataset> {
  signal.throwIfAborted()
  try {
    const result = await request<CatalogPage>(`/catalog?dataset_id=${dataset.dataset_id}`, { signal })
    signal.throwIfAborted()
    const resolved = result.datasets.find(item => item.dataset_id === dataset.dataset_id)
    if (resolved) return resolved
  } catch {
    signal.throwIfAborted()
  }
  return { ...dataset, catalog_status: undefined, error_code: "dataset_unavailable" }
}

export async function loadReportCatalogPage(request: CatalogRequest, offset: number, signal: AbortSignal,
  onPage: (page: CatalogPage) => void, onDataset: (dataset: CatalogDataset) => void, options: { metadataOnly?: boolean } = {}) {
  signal.throwIfAborted()
  const page = await request<CatalogPage>(`/catalog?metadata_only=true&offset=${offset}`, { signal })
  if (signal.aborted) return
  onPage(page)
  if (options.metadataOnly) return
  const pending = page.datasets.filter(dataset => dataset.catalog_status === "pending")
  let index = 0
  async function worker() {
    while (!signal.aborted && index < pending.length) {
      const dataset = pending[index++]
      try {
        const resolved = await loadReportCatalogDataset(request, dataset, signal)
        if (signal.aborted) return
        onDataset(resolved)
      } catch {
        if (signal.aborted) return
        onDataset({ ...dataset, catalog_status: undefined, error_code: "dataset_unavailable" })
      }
    }
  }
  // Limit concurrent file reads and memory use; publish each source as it finishes.
  await Promise.all([worker(), worker()])
}
