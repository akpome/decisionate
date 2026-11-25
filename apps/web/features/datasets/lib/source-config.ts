type DatasetSourceConfig = {
  ingestion_mode?: string
  original_file_name?: string
  file_extension?: string
  file_format?: string
  stored_file_format?: string
  join_metric_sources?: Record<string, unknown>
  join_aggregation_type?: string
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
        stored_file_format:
          cleanStringValue(
            parsedConfig.stored_file_format
          ),
        join_metric_sources: parsedConfig.join_metric_sources && typeof parsedConfig.join_metric_sources === "object" && !Array.isArray(parsedConfig.join_metric_sources)
          ? parsedConfig.join_metric_sources : undefined,
        join_aggregation_type: cleanStringValue(parsedConfig.join_definition?.aggregation_type),
      }
    }
  } catch {
    return null
  }

  return null
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
    storedFileFormat:
      parsedConfig?.stored_file_format ||
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
