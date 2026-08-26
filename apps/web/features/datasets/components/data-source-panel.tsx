"use client"

import {
  type DatasetSourceOption,
} from "@/lib/api"

import { ConnectionSetupGuide } from "@/features/datasets/components/data-source-connections"

interface DataSourcePanelProps {
  sources: DatasetSourceOption[]
  savedSourceTypes?: string[]
  creatingSourceType?: string | null
  onCreateConnection?: (
    source: DatasetSourceOption
  ) => void
}

const SOURCE_CATEGORY_ORDER = [
  "files",
  "analytics",
  "commerce",
  "payments",
  "accounting",
  "databases",
  "business_apps",
  "other",
]

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
  const orderedSourceGroups =
    Object.entries(groupedSources).sort(
      ([leftCategory], [rightCategory]) =>
        getSourceCategoryRank(
          leftCategory
        ) -
        getSourceCategoryRank(
          rightCategory
        )
    )

  return (
    <div className="space-y-6">
      {orderedSourceGroups.map(
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
                      "upload" &&
                    source.status !==
                      "planned"
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
                      className="flex min-w-0 flex-col gap-3 bg-white p-4 first:rounded-t-xl last:rounded-b-xl sm:flex-row sm:items-start sm:justify-between sm:gap-4"
                    >
                      <div className="min-w-0">
                        <h4 className="break-words font-medium">
                          {source.label}
                        </h4>

                        <p className="mt-1 break-words text-sm text-gray-500">
                          {
                            source.description
                          }
                        </p>

                        {source.status === "planned" && (
                          <p className="mt-2 break-words text-xs font-medium text-gray-400">
                            This connector is not enabled on the server yet.
                          </p>
                        )}

                        <p className="mt-2 break-words text-xs font-medium uppercase text-gray-400">
                          {formatSourceConnection(
                            source.connection_type
                          )}
                          {" / "}
                          {formatSyncModes(
                            source.sync_modes
                          )}
                        </p>

                        {source.availability_note && (
                          <p className="mt-1 break-words text-xs text-amber-700">
                            {
                              source.availability_note
                            }
                          </p>
                        )}

                        {source.connection_type !==
                          "upload" &&
                          (hasConfigKeys ||
                            hasEnvironmentKeys) && (
                          <ConnectionSetupGuide
                            source={source}
                            compact
                          />
                        )}

                        {canCreateDraft &&
                          (hasConfigKeys ||
                            hasEnvironmentKeys) && (
                          <p className="mt-1 break-words text-xs text-gray-400">
                            Required details are collected after this connection is added.
                          </p>
                        )}
                      </div>

                      <div className="flex w-full shrink-0 flex-col items-start gap-2 sm:w-auto sm:items-end">
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
                              className="w-full rounded-lg border px-3 py-1.5 text-center text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
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

function getSourceCategoryRank(
  category: string
) {
  const index =
    SOURCE_CATEGORY_ORDER.indexOf(
      category
    )

  return index === -1
    ? SOURCE_CATEGORY_ORDER.length
    : index
}

function formatSourceConnection(
  connectionType?: string
) {
  if (
    connectionType ===
    "object_storage"
  ) {
    return "Object Storage"
  }

  if (connectionType === "api_key") {
    return "API Key"
  }

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
