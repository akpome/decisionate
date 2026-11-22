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
}: DataSourcePanelProps) {
  const { t } = useDecisionateText()
  const mutationPending = creatingSourceType != null || deletingConnectionId != null
  const addedTypes = new Set(connections.map(connection => normalizeSourceType(connection.source_type)))
  const groupedSources =
    sources.reduce<
      Record<string, DatasetSourceOption[]>
    >((groups, source) => {
      if (addedTypes.has(normalizeSourceType(source.type))) return groups
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
      {!loadError && sources.length > 0 && !orderedSourceGroups.length && (
        <p role="status" className="py-4 text-sm text-gray-600">{t("All available sources have been added.")}</p>
      )}
      {orderedSourceGroups.map(
        ([category, categorySources]) => (
          <section key={category}>
            <h3 className="text-sm font-semibold uppercase text-gray-500">
              {t(formatSourceCategory(category))}
            </h3>

            <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-3">
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
                  const isCreating = creatingSourceType === source.type
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
                      className="@container flex min-w-0 flex-col gap-2 rounded-lg border border-gray-200 bg-white p-3"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                        <h4 className="min-w-0 break-words font-medium">{source.label}</h4>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                            isAvailable
                              ? "bg-green-50 text-green-700"
                              : needsSetup
                                ? "bg-amber-50 text-amber-700"
                                : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {isAvailable ? t("Available") : needsSetup ? t("Setup needed") : t("Planned")}
                        </span>
                      </div>
                      <div className="min-w-0 w-full">
                        <p className="break-words text-sm leading-5 text-gray-600">
                          {
                            source.description
                          }
                        </p>

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
                      </div>

                      {canCreateDraft && (
                        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-gray-100">
                            <div className="flex min-h-10 min-w-28 flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="text-xs font-medium text-gray-600" role="status">
                                {isCreating ? (
                                  <span className="inline-flex items-center gap-1.5">
                                    <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                                    {t("Adding...")}
                                  </span>
                                ) : t(loadError ? "Unavailable" : "Off")}
                              </span>
                              <button
                                type="button"
                                role="switch"
                                aria-label={source.label}
                                aria-checked={false}
                                title={t("Add connection")}
                                disabled={mutationPending || loadError}
                                onClick={() => onCreateConnection(source)}
                                className="order-first flex h-10 w-12 shrink-0 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--decisionate-brand-primary)] disabled:cursor-not-allowed disabled:opacity-70"
                              >
                                <span aria-hidden="true" className="inline-flex h-6 w-11 items-center justify-start rounded-full border border-gray-500 bg-gray-600 p-0.5">
                                  <span className="size-4 rounded-full bg-white shadow-sm" />
                                </span>
                              </button>
                            </div>
                        </div>
                      )}
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
