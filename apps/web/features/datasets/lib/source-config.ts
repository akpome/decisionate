type DatasetSourceConfig = {
  ingestion_mode?: string
  original_file_name?: string
  file_extension?: string
  file_format?: string
}

function cleanStringValue(
  value: unknown
) {
  return typeof value === "string"
    ? value.trim() || undefined
    : undefined
}

export function parseDatasetSourceConfig(
  sourceConfig?: string | null
): DatasetSourceConfig | null {
  if (!sourceConfig) {
    return null
  }

  try {
    const parsedConfig =
      JSON.parse(sourceConfig)

    if (
      parsedConfig &&
      typeof parsedConfig === "object" &&
      !Array.isArray(parsedConfig)
    ) {
      return {
        ingestion_mode:
          cleanStringValue(
            parsedConfig.ingestion_mode
          ),
        original_file_name:
          cleanStringValue(
            parsedConfig.original_file_name
          ),
        file_extension:
          cleanStringValue(
            parsedConfig.file_extension
          ),
        file_format:
          cleanStringValue(
            parsedConfig.file_format
          ),
      }
    }
  } catch {
    return null
  }

  return null
}

export function formatDatasetSource(
  sourceType?: string | null,
  sourceConfig?: string | null,
  sourceLabel?: string | null
) {
  return getDatasetSourceDetails(
    sourceType,
    sourceConfig,
    sourceLabel
  ).label
}

export function getDatasetOriginalFileName(
  sourceConfig?: string | null
) {
  return getDatasetSourceDetails(
    undefined,
    sourceConfig
  ).originalFileName
}

export function getDatasetSourceDetails(
  sourceType?: string | null,
  sourceConfig?: string | null,
  sourceLabel?: string | null
) {
  const parsedConfig =
    parseDatasetSourceConfig(
      sourceConfig
    )
  const format =
    parsedConfig?.file_format ||
    cleanStringValue(sourceType) ||
    "csv"
  const formattedFormat =
    cleanStringValue(sourceLabel) ||
    formatSourceValue(format)
  const isUpload =
    parsedConfig?.ingestion_mode ===
    "upload"

  return {
    config: parsedConfig,
    format,
    formattedFormat,
    label: isUpload
      ? `Uploaded ${formattedFormat}`
      : formattedFormat,
    ingestionMode:
      parsedConfig?.ingestion_mode ||
      null,
    originalFileName:
      parsedConfig?.original_file_name ||
      null,
    fileExtension:
      parsedConfig?.file_extension ||
      null,
  }
}

export function formatSourceValue(
  value?: string | null
) {
  return (
    cleanStringValue(value) || "csv"
  )
    .replace(/_/g, " ")
    .toUpperCase()
}
