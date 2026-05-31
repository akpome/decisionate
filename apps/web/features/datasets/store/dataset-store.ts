import { create } from "zustand"

export interface DatasetRow {
  [key: string]: string | number | null
}

interface DatasetState {
  fileName: string
  columns: string[]
  rows: DatasetRow[]

  setDataset: (
    fileName: string,
    rows: DatasetRow[]
  ) => void

  clearDataset: () => void
}

export const useDatasetStore = create<DatasetState>(
  (set) => ({
    fileName: "",
    columns: [],
    rows: [],

    setDataset: (fileName, rows) => {

      const columns =
        rows.length > 0
          ? Object.keys(rows[0])
          : []

      set({
        fileName,
        columns,
        rows,
      })
    },

    clearDataset: () =>
      set({
        fileName: "",
        columns: [],
        rows: [],
      }),
  })
)