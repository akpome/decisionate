"use client"

import {
  type DataSourceConnection,
  type DatasetSourceOption,
} from "@/lib/api"
import { LoaderCircle } from "lucide-react"

import { ConnectionSetupGuide } from "@/features/datasets/components/data-source-connections"
import { useDecisionateText } from "@/app/use-decisionate-language"

interface DataSourcePanelProps {
  sources: DatasetSourceOption[]
  connections: DataSourceConnection[]
  creatingSourceType?: string | null
  deletingConnectionId?: number | null
  loadError?: boolean
  onCreateConnection: (source: DatasetSourceOption) => void
  onRemoveConnection: (connection: DataSourceConnection) => void
}

const SOURCE_CATEGORY_ORDER = [
  "files",
  "analytics",
  "commerce",
  "restaurant",
  "payments",
  "accounting",
  "databases",
  "business_apps",
  "other",
]

export function DataSourcePanel({
  sources,
  connections,
  creatingSourceType,
  deletingConnectionId,
  loadError,
  onCreateConnection,
  onRemoveConnection,
}: DataSourcePanelProps) {
  const { t } = useDecisionateText()
  const mutationPending = creatingSourceType != null || deletingConnectionId != null
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
              {t(formatSourceCategory(category))}
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
                  const savedConnections = connections.filter(connection =>
                    normalizeSourceType(connection.source_type) === normalizeSourceType(source.type)
                  )
                  const isSaved = savedConnections.length > 0
                  const hasMultiple = savedConnections.length > 1
                  const isCreating = creatingSourceType === source.type
                  const isRemoving = savedConnections.some(connection => connection.id === deletingConnectionId)
                  const pendingLabel = isCreating ? "Adding..." : isRemoving ? "Removing..." : ""
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
                      className="grid min-w-0 grid-cols-1 gap-3 bg-white p-4 first:rounded-t-xl last:rounded-b-xl sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-start sm:gap-4"
                    >
                      <div className="min-w-0 w-full">
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
                            {t("This connector is not enabled on the server yet.")}
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
                            ? t("Available")
                            : needsSetup
                              ? t("Setup needed")
                              : t("Planned")}
                        </span>

                        {canCreateDraft && (
                          <>
                            <div className="flex min-h-10 min-w-28 flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="text-xs font-medium text-gray-600" role="status">
                                {pendingLabel ? (
                                  <span className="inline-flex items-center gap-1.5">
                                    <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                                    {t(pendingLabel)}
                                  </span>
                                ) : t(loadError ? "Unavailable" : isSaved ? "On" : "Off")}
                              </span>
                              <button
                                type="button"
                                role="switch"
                                aria-label={source.label}
                                aria-checked={isSaved}
                                title={t(hasMultiple ? "Manage connections individually" : isSaved ? "Remove connection" : "Add connection")}
                                disabled={mutationPending || hasMultiple || loadError}
                                onClick={() => {
                                  if (isSaved) onRemoveConnection(savedConnections[0])
                                  else onCreateConnection(source)
                                }}
                                className="order-first flex h-10 w-12 shrink-0 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--decisionate-brand-primary)] disabled:cursor-not-allowed disabled:opacity-70"
                              >
                                <span aria-hidden="true" className={`inline-flex h-6 w-11 items-center rounded-full border p-0.5 transition-colors motion-reduce:transition-none ${isSaved ? "justify-end border-transparent bg-[var(--decisionate-brand-primary)]" : "justify-start border-gray-500 bg-gray-600"}`}>
                                  <span className="size-4 rounded-full bg-white shadow-sm" />
                                </span>
                              </button>
                            </div>
                            {hasMultiple && (
                              <a href="#saved-connections" className="text-xs font-medium text-[var(--decisionate-brand-primary-text)] underline">
                                {t("Manage connections")}
                              </a>
                            )}
                          </>
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
