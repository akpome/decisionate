"use client"

import {
  type DatasetSourceOption,
} from "@/lib/api"

interface DataSourcePanelProps {
  sources: DatasetSourceOption[]
  savedSourceTypes?: string[]
  creatingSourceType?: string | null
  onCreateConnection?: (
    source: DatasetSourceOption
  ) => void
}

export function DataSourcePanel({
  sources,
  savedSourceTypes = [],
  creatingSourceType,
  onCreateConnection,
}: DataSourcePanelProps) {
  const savedSourceTypeSet =
    new Set(
      savedSourceTypes.map(
        normalizeSourceType
      )
    )
  const groupedSources =
    sources.reduce<
      Record<string, DatasetSourceOption[]>
    >((groups, source) => {
      const category =
        source.category || "other"

      return {
        ...groups,
        [category]: [
          ...(groups[category] || []),
          source,
        ],
      }
    }, {})

  return (
    <div className="space-y-6">
      {Object.entries(groupedSources).map(
        ([category, categorySources]) => (
          <section key={category}>
            <h3 className="text-sm font-semibold uppercase text-gray-500">
              {formatSourceCategory(
                category
              )}
            </h3>

            <div className="mt-3 divide-y rounded-xl border">
              {categorySources.map(
                (source) => {
                  const isAvailable =
                    source.status ===
                    "available"
                  const needsSetup =
                    source.status ===
                    "needs_setup"
                  const canCreateDraft =
                    source.connection_type !==
                    "upload"
                  const isSaved =
                    savedSourceTypeSet.has(
                      normalizeSourceType(
                        source.type
                      )
                    )
                  const isCreating =
                    creatingSourceType ===
                    source.type
                  const hasConfigKeys =
                    Boolean(
                      source.config_keys
                        ?.length
                    )
                  const hasEnvironmentKeys =
                    Boolean(
                      source
                        .environment_keys
                        ?.length
                    )

                  return (
                    <div
                      key={source.type}
                      className="flex items-start justify-between gap-4 bg-white p-4 first:rounded-t-xl last:rounded-b-xl"
                    >
                      <div>
                        <h4 className="font-medium">
                          {source.label}
                        </h4>

                        <p className="mt-1 text-sm text-gray-500">
                          {
                            source.description
                          }
                        </p>

                        <p className="mt-2 text-xs font-medium uppercase text-gray-400">
                          {formatSourceConnection(
                            source.connection_type
                          )}
                          {" / "}
                          {formatSyncModes(
                            source.sync_modes
                          )}
                        </p>

                        {source.availability_note && (
                          <p className="mt-1 text-xs text-amber-700">
                            {
                              source.availability_note
                            }
                          </p>
                        )}

                        {hasConfigKeys && (
                          <p className="mt-1 text-xs text-gray-400">
                            Setup fields:{" "}
                            {formatConfigKeys(
                              source.config_keys ||
                                []
                            )}
                          </p>
                        )}

                        {hasEnvironmentKeys && (
                          <p className="mt-1 text-xs text-gray-400">
                            Provider credentials required during configuration.
                          </p>
                        )}
                      </div>

                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <span
                          className={
                            isAvailable
                              ? "rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700"
                              : needsSetup
                                ? "rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700"
                              : "rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600"
                          }
                        >
                          {isAvailable
                            ? "Available"
                            : needsSetup
                              ? "Setup needed"
                              : "Planned"}
                        </span>

                        {canCreateDraft &&
                          onCreateConnection && (
                            <button
                              type="button"
                              onClick={() =>
                                onCreateConnection(
                                  source
                                )
                              }
                              disabled={
                                isCreating ||
                                isSaved
                              }
                              className="rounded-lg border px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {getSourceActionLabel(
                                isCreating,
                                isSaved
                              )}
                            </button>
                          )}
                      </div>
                    </div>
                  )
                }
              )}
            </div>
          </section>
        )
      )}
    </div>
  )
}

function normalizeSourceType(
  sourceType: string
) {
  return sourceType
    .trim()
    .toLowerCase()
}

function formatSourceCategory(
  category: string
) {
  return category
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) =>
      letter.toUpperCase()
    )
}

function formatSourceConnection(
  connectionType?: string
) {
  return (
    connectionType || "connector"
  )
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) =>
      letter.toUpperCase()
    )
}

function formatSyncModes(
  syncModes?: string[]
) {
  if (!syncModes?.length) {
    return "Manual"
  }

  return syncModes
    .map((mode) =>
      mode
        .replace(/_/g, " ")
        .replace(/\b\w/g, (letter) =>
          letter.toUpperCase()
        )
    )
    .join(", ")
}

function formatConfigKeys(
  configKeys: string[]
) {
  return configKeys
    .map((key) =>
      key.replace(/_/g, " ")
    )
    .join(", ")
}

function getSourceActionLabel(
  isCreating: boolean,
  isSaved: boolean
) {
  if (isCreating) {
    return "Saving..."
  }

  if (isSaved) {
    return "Added"
  }

  return "Add connection"
}
