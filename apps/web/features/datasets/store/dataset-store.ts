export type DatasetValue =
  | string
  | number
  | boolean
  | null
  | undefined

export type DatasetRow = Record<
  string,
  DatasetValue
>

export type {
  DatasetSummary,
} from "@/lib/api"
